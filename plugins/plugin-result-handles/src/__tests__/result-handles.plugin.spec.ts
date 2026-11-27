import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  connect,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Resource,
  ResourceContext,
  tool,
  Tool,
  ToolContext,
  type CallToolResult,
  type DirectClient,
  type FlowCtxOf,
  type LogRecord,
  type ReadResourceResult,
} from '@frontmcp/sdk';

import { foldedAnswerSchema, type FoldedAnswer } from '../folded-answer';
import { ResultHandleStore } from '../result-handle.store';
import { ResultHandleOwnerRequiredError } from '../result-handles.errors';
import { RESULT_HANDLE_META_KEY, type FoldContext } from '../result-handles.options';
import ResultHandlesPlugin from '../result-handles.plugin';
import ResultQueryTool from '../result-query.tool';

const warnings: string[] = [];

@LogTransport({ name: 'ResultHandlesWarnings', description: 'Keeps warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

const rowSchema = z.object({ id: z.number(), title: z.string(), body: z.string() });

function rows(count: number) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    title: `Row ${id}`,
    body: `Body of row ${id} `.padEnd(200, '.'),
  }));
}

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

@Tool({ name: 'export_rows', inputSchema: { count: z.number() } })
class ExportRowsTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { rows: rows(count), total: count };
  }
}

@Tool({ name: 'unfolded_rows', inputSchema: { count: z.number() } })
class UnfoldedRowsTool extends ExportRowsTool {}

@Tool({
  name: 'typed_rows',
  inputSchema: { count: z.number() },
  outputSchema: z.union([z.object({ rows: z.array(rowSchema), total: z.number() }), foldedAnswerSchema]),
})
class TypedRowsTool extends ExportRowsTool {}

@Tool({
  name: 'strict_rows',
  inputSchema: { count: z.number() },
  outputSchema: { rows: z.array(rowSchema), total: z.number() },
})
class StrictRowsTool extends ExportRowsTool {}

@Tool({ name: 'long_text', inputSchema: {} })
class LongTextTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text', text: '[lorem] ipsum '.repeat(1000) }] };
  }
}

@Tool({ name: 'rows_text', inputSchema: {} })
class RowsTextTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text', text: JSON.stringify(rows(100)) }] };
  }
}

@Tool({ name: 'two_texts', inputSchema: {} })
class TwoTextsTool extends ToolContext {
  async execute() {
    const text = JSON.stringify(rows(50));
    return {
      content: [
        { type: 'text', text },
        { type: 'text', text },
      ],
    };
  }
}

@Tool({ name: 'rows_and_summary', inputSchema: {} })
class RowsAndSummaryTool extends ToolContext {
  async execute() {
    const data = { rows: rows(100), total: 100 };
    return {
      content: [
        { type: 'text', text: JSON.stringify(data) },
        { type: 'text', text: 'Exported 100 rows from the archive.' },
      ],
      structuredContent: data,
    };
  }
}

@Tool({ name: 'rows_with_note', inputSchema: {} })
class RowsWithNoteTool extends ToolContext {
  async execute() {
    return {
      content: [{ type: 'text', text: 'Rows past 100 are in the archive.' }],
      structuredContent: { rows: rows(100), total: 100 },
    };
  }
}

@Tool({ name: 'echoed_object', inputSchema: {} })
class EchoedObjectTool extends ToolContext {
  async execute() {
    return {
      content: [{ type: 'text', text: 'Echoed the request.' }],
      structuredContent: { content: { toString: 1, rows: rows(100) } },
    };
  }
}

@Tool({ name: 'chart', inputSchema: {} })
class ChartTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'image', data: 'a'.repeat(10_000), mimeType: 'image/png' }] };
  }
}

@Tool({ name: 'failing_rows', inputSchema: {} })
class FailingRowsTool extends ToolContext {
  async execute() {
    return { content: [{ type: 'text', text: JSON.stringify(rows(100)) }], isError: true };
  }
}

@Tool({ name: 'row_count', inputSchema: {} })
class RowCountTool extends ToolContext {
  async execute() {
    const inner = await this.callTool('export_rows', { count: 100 });
    const answer = inner.structuredContent as { rows?: unknown[]; handle?: string };
    return { folded: answer.handle !== undefined, rows: answer.rows?.length };
  }
}

/** A tool with a JSON Schema `outputSchema`, as the OpenAPI adapter and remote apps build them. */
function apiTool(name: string, rawOutputSchema: Record<string, unknown>) {
  const metadata = { name, inputSchema: {}, rawOutputSchema };
  return tool(metadata as unknown as Parameters<typeof tool>[0])(async () => ({ data: rows(100) }));
}

const OpenApiRowsTool = apiTool('open_api_rows', { type: 'object', properties: { data: {} } });
const ClosedApiRowsTool = apiTool('closed_api_rows', {
  type: 'object',
  properties: { data: {} },
  additionalProperties: false,
});
const BrokenApiRowsTool = apiTool('broken_api_rows', { type: 'object', $ref: '#/$defs/missing' });

const foldPolicy = jest.fn((toolName: string, _answer: unknown, _context: FoldContext) => toolName !== 'unfolded_rows');

@App({
  id: 'exports',
  name: 'Exports',
  tools: [
    ExportRowsTool,
    UnfoldedRowsTool,
    TypedRowsTool,
    StrictRowsTool,
    LongTextTool,
    RowsTextTool,
    TwoTextsTool,
    RowsAndSummaryTool,
    RowsWithNoteTool,
    EchoedObjectTool,
    ChartTool,
    FailingRowsTool,
    RowCountTool,
    OpenApiRowsTool,
    ClosedApiRowsTool,
    BrokenApiRowsTool,
  ],
  plugins: [
    ResultHandlesPlugin.init({
      thresholdBytes: 4096,
      ttlSeconds: 60,
      preview: { items: 2, chars: 40 },
      storage: { type: 'memory' },
      foldPolicy,
    }),
  ],
})
class ExportsApp {}

const serverConfig = {
  info: { name: 'result-handles', version: '1.0.0' },
  apps: [ExportsApp],
  logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
};

const clients: DirectClient[] = [];

async function open(session?: { id: string; user?: { sub: string } }): Promise<DirectClient> {
  const client = await connect(serverConfig, session && { session });
  clients.push(client);
  return client;
}

async function call(client: DirectClient, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool(name, args)) as CallToolResult;
}

function textAt(result: CallToolResult, index: number): string {
  const block = result.content[index];
  return block?.type === 'text' ? block.text : '';
}

describe('ResultHandlesPlugin', () => {
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    warnings.length = 0;
    foldPolicy.mockClear();
    jest.restoreAllMocks();
  });

  describe('folding', () => {
    it('folds a large answer into a preview, a shape and a handle', async () => {
      const client = await open();
      const result = await call(client, 'export_rows', { count: 200 });
      const folded = result.structuredContent as unknown as FoldedAnswer;
      const bytes = bytesOf({ rows: rows(200), total: 200 });

      expect(folded.preview).toEqual({
        rows: [
          { id: 0, title: 'Row 0', body: 'Body of row 0 ..........................' },
          { id: 1, title: 'Row 1', body: 'Body of row 1 ..........................' },
        ],
        total: 200,
      });
      expect(folded.shape).toEqual({
        type: 'object',
        keys: {
          rows: {
            type: 'array',
            length: 200,
            items: {
              type: 'object',
              keys: {
                id: { type: 'number' },
                title: { type: 'string', length: 5 },
                body: { type: 'string', length: 200 },
              },
            },
          },
          total: { type: 'number' },
        },
      });
      expect(folded.handle).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.parse(textAt(result, 0))).toEqual(folded);
      expect(textAt(result, 1)).toBe(
        `This answer is ${bytes} bytes, so it was folded: preview is its start and shape its structure. ` +
          `Read the rest with result_query and handle "${folded.handle}" ` +
          '(a path, then offset and limit or a page, and fields) within 60 seconds.',
      );
      expect(result._meta?.[RESULT_HANDLE_META_KEY]).toEqual({ handle: folded.handle, bytes, ttlSeconds: 60 });
    });

    it('leaves an answer within the threshold alone', async () => {
      const client = await open();
      const result = await call(client, 'export_rows', { count: 2 });
      expect(result.structuredContent).toEqual({ rows: rows(2), total: 2 });
      expect(result._meta?.[RESULT_HANDLE_META_KEY]).toBeUndefined();
      expect(foldPolicy).not.toHaveBeenCalled();
    });

    it('asks the fold policy with the tool name, the answer and the context', async () => {
      const client = await open({ id: 'policy-session' });
      const unfolded = await call(client, 'unfolded_rows', { count: 100 });
      await call(client, 'export_rows', { count: 100 });

      expect(unfolded.structuredContent).toEqual({ rows: rows(100), total: 100 });
      expect(foldPolicy).toHaveBeenCalledTimes(2);
      const [toolName, answer, context] = foldPolicy.mock.calls[1];
      expect(toolName).toBe('export_rows');
      expect(answer).toEqual({ rows: rows(100), total: 100 });
      expect(context).toMatchObject({ bytes: bytesOf(answer), fullName: 'exports:export_rows' });
      expect(context.request.sessionId).toBe('policy-session');
    });

    it('folds an answer of one text, its preview the first characters', async () => {
      const client = await open();
      const result = await call(client, 'long_text');
      const folded = result.structuredContent as unknown as FoldedAnswer;
      expect(folded.preview).toBe('[lorem] ipsum [lorem] ipsum [lorem] ipsu');
      expect(folded.shape).toEqual({ type: 'string', length: 14_000 });
    });

    it('folds an answer of one JSON text as JSON', async () => {
      const client = await open();
      const result = await call(client, 'rows_text');
      const folded = result.structuredContent as unknown as FoldedAnswer;
      expect(folded.preview).toEqual(rows(2).map((row) => ({ ...row, body: row.body.slice(0, 40) })));
      expect(folded.shape).toMatchObject({ type: 'array', length: 100 });
    });

    it('folds a tool whose output schema admits the folded form', async () => {
      const client = await open();
      const result = await call(client, 'typed_rows', { count: 200 });
      expect(Object.keys(result.structuredContent ?? {})).toEqual(['preview', 'shape', 'handle']);
    });

    it('leaves a tool whose output schema cannot admit the folded form alone, and says so once', async () => {
      const client = await open();
      const first = await call(client, 'strict_rows', { count: 200 });
      await call(client, 'strict_rows', { count: 200 });

      expect((first.structuredContent as { rows: unknown[] }).rows).toHaveLength(200);
      expect(warnings).toEqual([
        `Tool "exports:strict_rows" answered ${bytesOf({ rows: rows(200), total: 200 })} bytes, over the ` +
          '4096-byte fold threshold, but its outputSchema does not admit the folded form { preview, shape, handle }, ' +
          'so its answers are sent whole. Make foldedAnswerSchema a member of a z.union() outputSchema to fold them.',
      ]);
    });

    it('folds a tool whose JSON Schema output schema validates the folded form, and leaves the others alone', async () => {
      const client = await open();
      const openSchema = await call(client, 'open_api_rows');
      const closed = await call(client, 'closed_api_rows');
      const broken = await call(client, 'broken_api_rows');

      expect(Object.keys(openSchema.structuredContent ?? {})).toEqual(['preview', 'shape', 'handle']);
      expect((closed.structuredContent as { data: unknown[] }).data).toHaveLength(100);
      expect((broken.structuredContent as { data: unknown[] }).data).toHaveLength(100);
      expect(warnings.map((warning) => warning.slice(0, 32))).toEqual([
        'Tool "exports:closed_api_rows" a',
        'Tool "exports:broken_api_rows" a',
      ]);
    });

    it('sends the answer whole, with a warning, when the store cannot keep it', async () => {
      jest.spyOn(ResultHandleStore.prototype, 'save').mockRejectedValueOnce(new Error('connection refused'));
      const client = await open();
      const result = await call(client, 'export_rows', { count: 200 });

      expect(result.structuredContent).toEqual({ rows: rows(200), total: 200 });
      expect(warnings).toEqual([
        'Could not keep the answer of tool "exports:export_rows" for result_query, so it is sent whole: connection refused',
      ]);
    });

    it('leaves media, several-text, error and in-process answers alone', async () => {
      const client = await open();
      expect((await call(client, 'chart')).content[0]?.type).toBe('image');
      expect((await call(client, 'two_texts')).content).toHaveLength(2);
      const withSummary = await call(client, 'rows_and_summary');
      expect(textAt(withSummary, 1)).toBe('Exported 100 rows from the archive.');
      expect(withSummary.structuredContent).toEqual({ rows: rows(100), total: 100 });
      const withNote = await call(client, 'rows_with_note');
      expect(textAt(withNote, 0)).toBe('Rows past 100 are in the archive.');
      expect(withNote.structuredContent).toEqual({ rows: rows(100), total: 100 });
      const echoed = await call(client, 'echoed_object');
      expect(echoed.isError).toBeFalsy();
      expect(textAt(echoed, 0)).toBe('Echoed the request.');
      const failing = await call(client, 'failing_rows');
      expect(failing.isError).toBe(true);
      expect(JSON.parse(textAt(failing, 0))).toHaveLength(100);
      expect((await call(client, 'row_count')).structuredContent).toEqual({ folded: false, rows: 100 });
    });
  });

  describe('result_query', () => {
    async function foldedHandle(client: DirectClient): Promise<string> {
      const result = await call(client, 'export_rows', { count: 200 });
      return (result.structuredContent as unknown as FoldedAnswer).handle;
    }

    it('reads slices of the stored answer by path, range, page and fields', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const range = await call(client, 'result_query', { handle, path: 'rows', offset: 150, limit: 2, fields: ['id'] });
      expect(range.structuredContent).toEqual({
        path: 'rows',
        value: [{ id: 150 }, { id: 151 }],
        total: 200,
        offset: 150,
        nextOffset: 152,
      });

      const page = await call(client, 'result_query', {
        handle,
        path: '/rows',
        page: 20,
        limit: 10,
        fields: ['title'],
      });
      expect((page.structuredContent as { value: unknown[] }).value).toHaveLength(10);
      expect(page.structuredContent).toMatchObject({ offset: 190 });

      const body = await call(client, 'result_query', { handle, path: '$.rows[3].body', offset: 0, limit: 14 });
      expect(body.structuredContent).toMatchObject({ value: 'Body of row 3 ', total: 200 });
    });

    it('refuses a slice over the threshold, saying how to narrow it', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const result = await call(client, 'result_query', { handle, path: 'rows', limit: 100 });
      expect(result.isError).toBe(true);
      expect(result._meta?.['code']).toBe('RESULT_SLICE_TOO_LARGE');
      expect(textAt(result, 0)).toContain('Read fewer items, fewer fields or a deeper path');
    });

    it('refuses a page past any list as invalid input', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const result = await call(client, 'result_query', {
        handle,
        path: 'rows',
        page: Number.MAX_SAFE_INTEGER,
        limit: 100_000,
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.['code']).toBe('INVALID_INPUT');
    });

    it('answers a path with no value with RESULT_PATH_NOT_FOUND', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const result = await call(client, 'result_query', { handle, path: 'rows[999]' });
      expect(result.isError).toBe(true);
      expect(result._meta?.['code']).toBe('RESULT_PATH_NOT_FOUND');
    });

    it('answers another session with "not found", never the data', async () => {
      const owner = await open({ id: 'owner-session' });
      const other = await open({ id: 'other-session' });
      const handle = await foldedHandle(owner);

      const result = await call(other, 'result_query', { handle, path: 'rows', limit: 1 });
      expect(result.isError).toBe(true);
      expect(result._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
      expect(JSON.stringify(result)).not.toContain('Body of row');
      expect(JSON.stringify(result)).not.toContain(handle);
    });

    it('answers another caller in the same session with "not found"', async () => {
      const alice = await open({ id: 'shared-session', user: { sub: 'alice' } });
      const mallory = await open({ id: 'shared-session', user: { sub: 'mallory' } });
      const handle = await foldedHandle(alice);

      expect((await call(alice, 'result_query', { handle, path: 'total' })).structuredContent).toMatchObject({
        value: 200,
      });
      const result = await call(mallory, 'result_query', { handle, path: 'total' });
      expect(result._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
    });

    it('filters, searches, sorts and counts the stored answer', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const filtered = await call(client, 'result_query', {
        handle,
        path: 'rows',
        where: [{ field: 'id', op: 'gte', value: 190 }],
        sort: [{ field: 'id', order: 'desc' }],
        limit: 3,
        fields: ['id'],
      });
      expect(filtered.structuredContent).toEqual({
        path: 'rows',
        value: [{ id: 199 }, { id: 198 }, { id: 197 }],
        total: 10,
        offset: 0,
        nextOffset: 3,
      });

      const counted = await call(client, 'result_query', {
        handle,
        path: 'rows',
        grep: { pattern: '^Row 1\\d$', regex: true, field: 'title' },
        count: true,
      });
      expect(counted.structuredContent).toEqual({ path: 'rows', value: 10 });
    });

    it('refuses a view it cannot run as invalid input, naming the problem', async () => {
      const client = await open();
      const handle = await foldedHandle(client);

      const wrongValue = await call(client, 'result_query', {
        handle,
        path: 'rows',
        where: [{ field: 'id', op: 'in', value: 3 }],
      });
      expect(wrongValue._meta?.['code']).toBe('INVALID_INPUT');
      expect(textAt(wrongValue, 0)).toContain('where[0]: "in" takes a list of values');

      const lookaround = await call(client, 'result_query', {
        handle,
        path: 'rows',
        grep: { pattern: '(?=Row)', regex: true },
      });
      expect(lookaround._meta?.['code']).toBe('INVALID_INPUT');
      expect(textAt(lookaround, 0)).toContain('a lookaround or a named group, which grep does not run');
    });

    it('answers "not found" once the handle outlives its TTL', async () => {
      const client = await open();
      const handle = await foldedHandle(client);
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

      const result = await call(client, 'result_query', { handle, path: 'total' });
      expect(result._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
      expect(textAt(result, 0)).toContain('Call the tool again for a new handle');
    });
  });

  describe('on two apps', () => {
    @Tool({ name: 'ledger_rows', inputSchema: { count: z.number() } })
    class LedgerRowsTool extends ExportRowsTool {}

    @Tool({ name: 'archive_rows', inputSchema: { count: z.number() } })
    class ArchiveRowsTool extends ExportRowsTool {}

    const plugins = () => [ResultHandlesPlugin.init({ thresholdBytes: 4096, storage: { type: 'memory' } })];

    @App({ id: 'ledger', name: 'Ledger', tools: [LedgerRowsTool], plugins: plugins() })
    class LedgerApp {}

    @App({ id: 'archive', name: 'Archive', tools: [ArchiveRowsTool], plugins: plugins() })
    class ArchiveApp {}

    it('lists one result_query, which reads the answers either app folded', async () => {
      const client = await connect({ ...serverConfig, apps: [LedgerApp, ArchiveApp] });
      clients.push(client);

      const tools = (await client.listTools()) as unknown as Array<{ name: string }>;
      expect(tools.map((listed) => listed.name).sort()).toEqual(['archive_rows', 'ledger_rows', 'result_query']);
      for (const toolName of ['ledger_rows', 'archive_rows']) {
        const folded = await call(client, toolName, { count: 200 });
        const { handle } = folded.structuredContent as unknown as FoldedAnswer;
        const slice = await call(client, 'result_query', { handle, path: 'rows[150].id' });
        expect(slice.structuredContent).toEqual({ path: 'rows[150].id', value: 150 });
      }
    });
  });

  describe('with slidingTtl', () => {
    @Tool({ name: 'sliding_rows', inputSchema: { count: z.number() } })
    class SlidingRowsTool extends ExportRowsTool {}

    @App({
      id: 'sliding',
      name: 'Sliding',
      tools: [SlidingRowsTool],
      plugins: [
        ResultHandlesPlugin.init({
          thresholdBytes: 4096,
          ttlSeconds: 60,
          slidingTtl: true,
          storage: { type: 'memory' },
        }),
      ],
    })
    class SlidingApp {}

    it('says the TTL runs from the last read, and keeps a handle read within each TTL', async () => {
      const client = await connect({ ...serverConfig, apps: [SlidingApp] });
      clients.push(client);
      const folded = await call(client, 'sliding_rows', { count: 200 });
      const { handle } = folded.structuredContent as unknown as FoldedAnswer;
      expect(textAt(folded, 1)).toMatch(/within 60 seconds of its last read\.$/);

      const now = Date.now();
      const clock = jest.spyOn(Date, 'now');
      for (const seconds of [50, 100, 150]) {
        clock.mockReturnValue(now + seconds * 1000);
        expect((await call(client, 'result_query', { handle, path: 'total' })).structuredContent).toMatchObject({
          value: 200,
        });
      }
      clock.mockReturnValue(now + 211_000);
      expect((await call(client, 'result_query', { handle, path: 'total' }))._meta?.['code']).toBe(
        'RESULT_HANDLE_NOT_FOUND',
      );
    });
  });

  describe('resource reads', () => {
    const rowsText = JSON.stringify({ rows: rows(100), total: 100 });

    @Resource({ name: 'rows-log', uri: 'exports://rows', mimeType: 'application/json' })
    class RowsResource extends ResourceContext {
      async execute(uri: string) {
        return { contents: [{ uri, mimeType: 'application/json', text: rowsText }] };
      }
    }

    @Resource({ name: 'plain-log', uri: 'exports://plain', mimeType: 'text/plain' })
    class PlainResource extends ResourceContext {
      async execute(uri: string) {
        const text = Array.from({ length: 300 }, (_, line) => `${line % 7 === 0 ? 'ERROR' : 'info'} line ${line}`);
        return { contents: [{ uri, mimeType: 'text/plain', text: text.join('\n') }] };
      }
    }

    @Resource({ name: 'skipped-log', uri: 'exports://skipped', mimeType: 'application/json' })
    class SkippedResource extends RowsResource {}

    @Resource({ name: 'page', uri: 'exports://page', mimeType: 'text/html' })
    class PageResource extends ResourceContext {
      async execute(uri: string) {
        return { contents: [{ uri, mimeType: 'text/html', text: `<p>${'x'.repeat(10_000)}</p>` }] };
      }
    }

    @Resource({ name: 'pair', uri: 'exports://pair', mimeType: 'application/json' })
    class PairResource extends ResourceContext {
      async execute(uri: string) {
        return {
          contents: [
            { uri, mimeType: 'application/json', text: rowsText },
            { uri, mimeType: 'application/json', text: rowsText },
          ],
        };
      }
    }

    @Resource({ name: 'small', uri: 'exports://small', mimeType: 'application/json' })
    class SmallResource extends ResourceContext {
      async execute(uri: string) {
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ rows: rows(2) }) }] };
      }
    }

    const quote = 'x'.repeat(5000);

    @Resource({ name: 'quote', uri: 'exports://quote', mimeType: 'application/json' })
    class QuoteResource extends ResourceContext {
      async execute(uri: string) {
        return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(quote) }] };
      }
    }

    const resources = [
      RowsResource,
      PlainResource,
      SkippedResource,
      PageResource,
      PairResource,
      SmallResource,
      QuoteResource,
    ];
    const resourcePolicy = jest.fn(
      (uri: string, _answer: unknown, _context: FoldContext) => uri !== 'exports://skipped',
    );
    const storage = { type: 'memory' as const };

    @App({
      id: 'library',
      name: 'Library',
      resources,
      plugins: [ResultHandlesPlugin.init({ thresholdBytes: 4096, storage, resources: resourcePolicy })],
    })
    class FoldingLibraryApp {}

    @App({
      id: 'library',
      name: 'Library',
      resources,
      plugins: [ResultHandlesPlugin.init({ thresholdBytes: 4096, storage })],
    })
    class DefaultLibraryApp {}

    async function openLibrary(app: object, session?: { id: string; user?: { sub: string } }) {
      const client = await connect(
        { ...serverConfig, apps: [app as typeof FoldingLibraryApp] },
        session && { session },
      );
      clients.push(client);
      return client;
    }

    async function read(client: DirectClient, uri: string) {
      return (await client.readResource(uri)) as ReadResourceResult & {
        contents: Array<{ uri: string; mimeType?: string; text: string }>;
      };
    }

    afterEach(() => resourcePolicy.mockClear());

    it('leaves resource reads whole unless resources is on', async () => {
      const client = await openLibrary(DefaultLibraryApp);
      const result = await read(client, 'exports://rows');

      expect(result.contents).toEqual([{ uri: 'exports://rows', mimeType: 'application/json', text: rowsText }]);
      expect(result._meta?.[RESULT_HANDLE_META_KEY]).toBeUndefined();
    });

    it('folds a large read into a preview, a shape and a handle, with a note naming result_query', async () => {
      const client = await openLibrary(FoldingLibraryApp, { id: 'reader-session' });
      const result = await read(client, 'exports://rows');
      const [content, note] = result.contents;
      const folded = JSON.parse(content.text) as FoldedAnswer;
      const bytes = bytesOf({ rows: rows(100), total: 100 });

      expect(content).toMatchObject({ uri: 'exports://rows', mimeType: 'application/json' });
      expect(Object.keys(folded)).toEqual(['preview', 'shape', 'handle']);
      expect((folded.preview as { rows: unknown[] }).rows).toHaveLength(5);
      expect(folded.shape).toMatchObject({ type: 'object', keys: { rows: { type: 'array', length: 100 } } });
      expect(note).toEqual({
        uri: 'exports://rows',
        mimeType: 'text/plain',
        text:
          `This answer is ${bytes} bytes, so it was folded: preview is its start and shape its structure. ` +
          `Read the rest with result_query and handle "${folded.handle}" ` +
          '(a path, then offset and limit or a page, and fields) within 600 seconds.',
      });
      expect(result._meta?.[RESULT_HANDLE_META_KEY]).toEqual({ handle: folded.handle, bytes, ttlSeconds: 600 });

      const [uri, answer, context] = resourcePolicy.mock.calls[0];
      expect(uri).toBe('exports://rows');
      expect(answer).toEqual({ rows: rows(100), total: 100 });
      expect(context).toMatchObject({ bytes, fullName: 'library:rows-log' });
      expect(context.request.sessionId).toBe('reader-session');

      const slice = await call(client, 'result_query', { handle: folded.handle, path: 'rows[42].id' });
      expect(slice.structuredContent).toEqual({ path: 'rows[42].id', value: 42 });
    });

    it('folds a read of plain text, whose lines result_query greps', async () => {
      const client = await openLibrary(FoldingLibraryApp);
      const result = await read(client, 'exports://plain');
      const { handle, shape } = JSON.parse(result.contents[0].text) as FoldedAnswer;
      expect(shape.type).toBe('string');

      const errors = await call(client, 'result_query', { handle, grep: { pattern: 'ERROR' }, limit: 2 });
      expect(errors.structuredContent).toEqual({
        path: '$',
        value: [
          { line: 1, text: 'ERROR line 0' },
          { line: 8, text: 'ERROR line 7' },
        ],
        total: 43,
        offset: 0,
        nextOffset: 2,
      });
    });

    it('folds a JSON resource whose value is a string as that string, not its JSON text', async () => {
      const client = await openLibrary(FoldingLibraryApp);
      const { handle, shape } = JSON.parse((await read(client, 'exports://quote')).contents[0].text) as FoldedAnswer;

      expect(shape.type).toBe('string');
      expect(resourcePolicy.mock.calls[0][1]).toBe(quote);
      expect((await call(client, 'result_query', { handle, limit: 3 })).structuredContent).toMatchObject({
        value: 'xxx',
        total: 5000,
      });
    });

    it('binds a resource handle to the session and the caller it was read by', async () => {
      // One config, so the three clients share one server and one store: Mallory's query reaches Alice's answer.
      const libraryConfig = { ...serverConfig, apps: [FoldingLibraryApp] };
      const sessionOf = async (session: { id: string; user: { sub: string } }) => {
        const client = await connect(libraryConfig, { session });
        clients.push(client);
        return client;
      };
      const alice = await sessionOf({ id: 'library-session', user: { sub: 'alice' } });
      const mallory = await sessionOf({ id: 'library-session', user: { sub: 'mallory' } });
      const other = await sessionOf({ id: 'other-session', user: { sub: 'alice' } });
      const { handle } = JSON.parse((await read(alice, 'exports://rows')).contents[0].text) as FoldedAnswer;

      expect((await call(alice, 'result_query', { handle, path: 'total' })).structuredContent).toMatchObject({
        value: 100,
      });
      for (const reader of [mallory, other]) {
        const result = await call(reader, 'result_query', { handle, path: 'total' });
        expect(result._meta?.['code']).toBe('RESULT_HANDLE_NOT_FOUND');
        expect(JSON.stringify(result)).not.toContain('Body of row');
      }
    });

    it('leaves a read the policy declines, several contents, HTML and a small read whole', async () => {
      const client = await openLibrary(FoldingLibraryApp);
      expect((await read(client, 'exports://skipped')).contents[0].text).toBe(rowsText);
      expect((await read(client, 'exports://pair')).contents).toHaveLength(2);
      expect((await read(client, 'exports://page')).contents[0].mimeType).toBe('text/html');
      const small = await read(client, 'exports://small');
      expect(small._meta?.[RESULT_HANDLE_META_KEY]).toBeUndefined();
      expect(resourcePolicy.mock.calls.map(([uri]) => uri)).toEqual(['exports://skipped']);
    });

    it("leaves an agent's read, and a read nobody could read back, whole", async () => {
      const plugin = new ResultHandlesPlugin({ thresholdBytes: 1024, resources: true });
      const respond = jest.fn();
      const flowOf = (resourceContext: object, ctx: object) =>
        ({
          rawInput: { ctx },
          state: {
            resource: { fullName: 'library:rows-log' },
            resourceContext,
            output: { contents: [{ uri: 'exports://rows', text: rowsText }] },
            isUIResource: false,
          },
          respond,
        }) as unknown as FlowCtxOf<'resources:read-resource'>;
      const signedIn = {
        tryGetContext: () => ({ verifiedSessionId: 's-1' }),
        auth: { isAnonymous: false, user: { sub: 'a' } },
      };
      const nobody = { tryGetContext: () => undefined, auth: { isAnonymous: true, user: { sub: 'anon:1' } } };

      await plugin.foldResource(flowOf(signedIn, { agentPrivateCall: true }));
      await plugin.foldResource(flowOf(signedIn, { internalCall: true }));
      await plugin.foldResource(flowOf(nobody, {}));
      expect(respond).not.toHaveBeenCalled();
    });
  });

  describe('a call nobody could read back', () => {
    it('is left alone', async () => {
      const plugin = new ResultHandlesPlugin({ thresholdBytes: 1024 });
      const output = { content: [{ type: 'text', text: JSON.stringify(rows(50)) }] };
      const respond = jest.fn();
      const flowCtx = {
        state: {
          tool: { fullName: 'exports:export_rows' },
          toolContext: {
            tryGetContext: () => ({ verifiedSessionId: undefined }),
            auth: { isAnonymous: true, user: { sub: 'anon:1' } },
          },
          output,
        },
        toolName: 'export_rows',
        isClientCall: () => true,
        respond,
      } as unknown as FlowCtxOf<'tools:call-tool'>;

      await plugin.foldAnswer(flowCtx);
      expect(respond).not.toHaveBeenCalled();
    });

    it('is refused by result_query, which says it needs a session or a signed-in caller', async () => {
      const anonymousStateless = {
        tryGetContext: () => undefined,
        auth: { isAnonymous: true, user: { sub: 'anon:1' } },
      };

      const refusal = ResultQueryTool.prototype.execute.call(anonymousStateless, {
        handle: '0b8e2f6a-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
      });
      await expect(refusal).rejects.toBeInstanceOf(ResultHandleOwnerRequiredError);
      await expect(refusal).rejects.toThrow('result_query needs a session or a signed-in caller');
    });
  });
});
