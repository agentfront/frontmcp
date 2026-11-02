import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, rpc20260728 } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type LogRecord,
  type OutputPolicy,
} from '../../../common';

const documentHit = z.object({ kind: z.literal('document'), title: z.string() });
const personHit = z.object({ kind: z.literal('person'), name: z.string() });

@Tool({ name: 'search', inputSchema: {}, outputSchema: z.union([documentHit, personHit]) })
class SearchTool extends ToolContext {
  async execute() {
    return { kind: 'document' as const, title: 'Roadmap' };
  }
}

@Tool({ name: 'resolve', inputSchema: {}, outputSchema: z.discriminatedUnion('kind', [documentHit, personHit]) })
class ResolveTool extends ToolContext {
  async execute() {
    return { kind: 'person' as const, name: 'Ada' };
  }
}

@Tool({
  name: 'invoice',
  inputSchema: {},
  outputSchema: { id: z.string(), lines: z.array(z.object({ sku: z.string() })) },
})
class InvoiceTool extends ToolContext {
  async execute() {
    return { id: 'INV-1', lines: [] };
  }
}

@App({ id: 'directory', name: 'Directory', tools: [SearchTool, ResolveTool, InvoiceTool] })
class DirectoryApp {}

@Tool({
  name: 'archive_entry',
  inputSchema: {},
  outputSchema: { id: z.string(), tags: z.array(z.object({ label: z.string() })) },
})
class ArchiveEntryTool extends ToolContext {
  async execute() {
    return { id: 'A-1', tags: [] };
  }
}

@Plugin({ name: 'archive-index', tools: [ArchiveEntryTool] })
class ArchiveIndexPlugin {}

@App({ id: 'archive', name: 'Archive', plugins: [ArchiveIndexPlugin], output: { undeclaredKeys: 'keep' } })
class ArchiveApp {}

async function listOutputSchemas(output?: OutputPolicy): Promise<Map<string, Record<string, unknown> | undefined>> {
  const server = await createTestFetchServer({
    info: { name: 'tools-list-output-schema', version: '1.0.0' },
    apps: [DirectoryApp, ArchiveApp],
    ...(output && { output }),
  });
  const { message } = await rpc20260728(server.handler, 'tools/list');
  const tools = (message.result?.['tools'] as Array<{ name: string; outputSchema?: Record<string, unknown> }>) ?? [];
  return new Map(tools.map((tool) => [tool.name, tool.outputSchema]));
}

describe('tools/list output schema', () => {
  it('lists a union of object schemas with a top-level object type', async () => {
    const schemas = await listOutputSchemas();

    expect(schemas.get('search')).toMatchObject({
      type: 'object',
      anyOf: [{ properties: { title: { type: 'string' } } }, { properties: { name: { type: 'string' } } }],
    });
  });

  it('lists a discriminated union with a top-level object type', async () => {
    const schemas = await listOutputSchemas();

    expect(schemas.get('resolve')).toMatchObject({ type: 'object', oneOf: [{ type: 'object' }, { type: 'object' }] });
  });

  it('lists object schemas closed to undeclared keys by default', async () => {
    const schemas = await listOutputSchemas();

    expect(JSON.stringify(schemas.get('invoice'))).toContain('"additionalProperties":false');
  });

  it("lists object schemas open to undeclared keys under 'keep', at every level", async () => {
    const schemas = await listOutputSchemas({ undeclaredKeys: 'keep' });

    expect(schemas.get('invoice')).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
    expect(JSON.stringify([...schemas.values()])).not.toContain('"additionalProperties":false');
  });

  it("lists a plugin's tool open under its app's 'keep', and other apps' tools closed", async () => {
    const schemas = await listOutputSchemas();

    expect(schemas.get('archive_entry')).toMatchObject({ type: 'object', properties: { id: { type: 'string' } } });
    expect(JSON.stringify(schemas.get('archive_entry'))).not.toContain('"additionalProperties":false');
    expect(JSON.stringify(schemas.get('invoice'))).toContain('"additionalProperties":false');
  });
});

const startupWarnings: string[] = [];

@LogTransport({ name: 'UnlistedOutputSchemaCapture', description: 'Keeps warnings for assertions' })
class StartupWarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) startupWarnings.push(record.message);
  }
}

@Tool({ name: 'list_hits', inputSchema: {}, outputSchema: z.array(documentHit) })
class ListHitsTool extends ToolContext {
  async execute() {
    return [];
  }
}

@Tool({
  name: 'list_hits_quietly',
  inputSchema: {},
  outputSchema: z.array(documentHit),
  output: { schemaMode: 'none' },
})
class ListHitsQuietlyTool extends ToolContext {
  async execute() {
    return [];
  }
}

@Tool({ name: 'list_archived_hits', inputSchema: {}, outputSchema: z.array(documentHit) })
class ListArchivedHitsTool extends ToolContext {
  async execute() {
    return [];
  }
}

@Plugin({ name: 'archived-hits', tools: [ListArchivedHitsTool] })
class ArchivedHitsPlugin {}

@App({ id: 'hits', name: 'Hits', tools: [ListHitsTool, ListHitsQuietlyTool, SearchTool] })
class HitsApp {}

@App({ id: 'quiet-hits', name: 'QuietHits', plugins: [ArchivedHitsPlugin], output: { schemaMode: 'none' } })
class QuietHitsApp {}

describe('startup warning for an outputSchema tools/list leaves out', () => {
  afterEach(() => {
    startupWarnings.length = 0;
  });

  function unlistedOutputSchemaWarnings(): string[] {
    return startupWarnings.filter((line) => line.includes('leaves out its outputSchema'));
  }

  async function startServer(output?: OutputPolicy) {
    await createTestFetchServer({
      info: { name: 'unlisted-output-schema', version: '1.0.0' },
      apps: [HitsApp, QuietHitsApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [StartupWarningCapture] },
      ...(output && { output }),
    });
  }

  it("names the tool, once, and stays quiet for a tool or an app whose schemaMode is 'none'", async () => {
    await startServer();

    expect(unlistedOutputSchemaWarnings()).toEqual([
      'Tool "list_hits": tools/list leaves out its outputSchema because it is not an object schema or a union of ' +
        'object schemas. Declare a z.object() or a union of z.object() schemas to list it.',
    ]);
  });

  it("stays quiet for every tool when the server's schemaMode is 'none'", async () => {
    await startServer({ schemaMode: 'none' });

    expect(unlistedOutputSchemaWarnings()).toEqual([]);
  });
});
