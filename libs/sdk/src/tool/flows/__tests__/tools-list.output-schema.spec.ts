import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, rpc20260728 } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type OutputPolicy } from '../../../common';

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

async function listOutputSchemas(output?: OutputPolicy): Promise<Map<string, Record<string, unknown> | undefined>> {
  const server = await createTestFetchServer({
    info: { name: 'tools-list-output-schema', version: '1.0.0' },
    apps: [DirectoryApp],
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
});
