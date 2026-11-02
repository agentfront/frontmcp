import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowControl,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../../common';
import { connect } from '../../../direct';
import { CallRecorderConfigurationError, PublicMcpError, refused } from '../../../errors';
import { CallRecorderPlugin, type CallRecord, type CallRecorderPluginOptionsInput } from '../index';

const ToolHook = FlowHooksOf('tools:call-tool');
const warnings: string[] = [];

@LogTransport({ name: 'RecorderWarningCapture', description: 'Captures the warnings the recorder logs' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(String(record.message));
  }
}

@Tool({ name: 'quote', inputSchema: { city: z.string(), password: z.string().optional() } })
class QuoteTool extends ToolContext {
  async execute(input: { city: string; password?: string }) {
    return { city: input.city, price: 12, accessToken: 'tok-secret-1' };
  }
}

@Tool({ name: 'lookup', inputSchema: { key: z.string() } })
class LookupTool extends ToolContext {
  async execute(input: { key: string }) {
    return { key: input.key, value: 'v' };
  }
}

@Tool({ name: 'report', inputSchema: {} })
class ReportTool extends ToolContext {
  async execute() {
    return { rows: [1, 2, 3] };
  }
}

@Tool({ name: 'skipped', inputSchema: {} })
class SkippedTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@Tool({ name: 'crash', inputSchema: {} })
class CrashTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw new PublicMcpError('ledger offline', 'LEDGER_OFFLINE');
  }
}

@Tool({ name: 'refused', inputSchema: {}, outputSchema: { count: z.number() } })
class RefusedTool extends ToolContext {
  async execute() {
    return { count: 'many' } as unknown as { count: number };
  }
}

@Tool({ name: 'long_report', inputSchema: {}, execution: { taskSupport: 'required' } })
class LongReportTool extends ToolContext {
  async execute() {
    return { done: true };
  }
}

@Tool({ name: 'relay', inputSchema: {} })
class RelayTool extends ToolContext {
  async execute() {
    await this.callTool('lookup', { key: 'inner' });
    return { relayed: true };
  }
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.c2lnbmF0dXJlLXNlY3JldA';
const HANDLE = '0f0e0d0c-0b0a-4908-8706-050403020100';

@Tool({
  name: 'fetch_page',
  inputSchema: { q: z.string(), url: z.string(), headers: z.record(z.string(), z.string()) },
})
class FetchPageTool extends ToolContext {
  async execute(input: { q: string; url: string; headers: Record<string, string> }) {
    return {
      url: input.url,
      sessionId: 'session-0123456789abcdef',
      note: `called with Bearer sk-answer-${JWT.length}`,
    };
  }
}

@Tool({ name: 'expired', inputSchema: {} })
class ExpiredTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw new PublicMcpError(`token ${JWT} has expired`, 'TOKEN_EXPIRED');
  }
}

@Tool({ name: 'broken', inputSchema: {} })
class BrokenTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw new Error('cannot reach postgres://app:db-pass-1@db.internal/shop');
  }
}

@Tool({ name: 'reviews', inputSchema: {} })
class ReviewsTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    throw refused('Reviews are off', { remedy: { say: 'Turn on Reviews in Settings' } });
  }
}

@Tool({ name: 'big_report', inputSchema: {} })
class BigReportTool extends ToolContext {
  async execute() {
    return { rows: [1, 2, 3] };
  }
}

@Tool({ name: 'read_folded', inputSchema: { handle: z.string() } })
class ReadFoldedTool extends ToolContext {
  async execute(input: { handle: string }) {
    return { read: input.handle.length };
  }
}

@Resource({ name: 'motd', uri: 'notes://motd', mimeType: 'text/plain' })
class MotdResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'hello' }] };
  }
}

@Prompt({ name: 'greet', arguments: [{ name: 'who', required: true }] })
class GreetPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Hello ${args['who']}` } }] };
  }
}

@Plugin({ name: 'folding' })
class FoldingPlugin {
  @ToolHook.Will('fitAnswer', { filter: (flow) => flow.toolName === 'report' })
  fold(flow: FlowCtxOf<'tools:call-tool'>) {
    flow.respond({ content: [{ type: 'text', text: 'folded' }], structuredContent: { handle: 'h-1' } });
  }

  @ToolHook.Will('fitAnswer', { filter: (flow) => flow.toolName === 'big_report' })
  foldWithHandle(flow: FlowCtxOf<'tools:call-tool'>) {
    flow.respond({
      content: [
        { type: 'text', text: JSON.stringify({ preview: [1], handle: HANDLE }) },
        { type: 'text', text: `Read the rest with handle "${HANDLE}"` },
      ],
      structuredContent: { preview: [1], handle: HANDLE },
      _meta: { 'frontmcp/result-handle': { handle: HANDLE, bytes: 20, ttlSeconds: 60 } },
    });
  }

  @ToolHook.Will('execute', { filter: (flow) => flow.toolName === 'skipped' })
  skip() {
    FlowControl.handled();
  }
}

@App({
  id: 'shop',
  name: 'Shop',
  plugins: [FoldingPlugin],
  tools: [
    QuoteTool,
    LookupTool,
    ReportTool,
    SkippedTool,
    CrashTool,
    RefusedTool,
    LongReportTool,
    RelayTool,
    FetchPageTool,
    ExpiredTool,
    BrokenTool,
    ReviewsTool,
    BigReportTool,
    ReadFoldedTool,
  ],
  resources: [MotdResource],
  prompts: [GreetPrompt],
})
class ShopApp {}

@Tool({ name: 'other_ping', inputSchema: {} })
class OtherPingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-recorder-'));
  warnings.length = 0;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function config(options: CallRecorderPluginOptionsInput): FrontMcpConfigInput {
  return {
    info: { name: 'call-recorder', version: '1.0.0' },
    apps: [ShopApp],
    plugins: [CallRecorderPlugin.init(options)],
    logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
  } as FrontMcpConfigInput;
}

async function session(
  options: CallRecorderPluginOptionsInput,
  run: (client: Awaited<ReturnType<typeof connect>>) => Promise<void>,
) {
  const client = await connect(config(options), { clientInfo: { name: 'desk-client', version: '2.1.0' } });
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

function recordsIn(file: string): CallRecord[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CallRecord);
}

describe('CallRecorderPlugin', () => {
  it('writes one line per tool call with its name, input, answer, duration, session and client', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('lookup', { key: 'user:1' });
    });

    const [record] = recordsIn(file);
    expect(record).toMatchObject({
      v: 1,
      method: 'tools/call',
      name: 'lookup',
      client: { name: 'desk-client', version: '2.1.0' },
    });
    expect(record.input).toEqual({ key: '[REDACTED]' });
    expect(record.answer).toMatchObject({ structuredContent: { key: '[REDACTED]', value: 'v' } });
    expect(record.error).toBeUndefined();
    expect(typeof record.durationMs).toBe('number');
    expect(Date.parse(record.at)).not.toBeNaN();
    expect(record.session).toMatch(/^.{8}\.\.\.$/);
  });

  it('records a failing tool with the error code and message its client sees, and no answer', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('crash', {});
      await client.callTool('refused', {});
      await client.callTool('missing', {});
    });

    const records = recordsIn(file);
    expect(records.map(({ name, error, answer }) => ({ name, error, answer }))).toEqual([
      { name: 'crash', error: { code: 'LEDGER_OFFLINE', message: 'ledger offline' }, answer: undefined },
      { name: 'refused', error: { code: 'INVALID_OUTPUT' }, answer: undefined },
      { name: 'missing', error: { code: 'TOOL_NOT_FOUND', message: expect.any(String) }, answer: undefined },
    ]);
  });

  it("records a public error's text as its client reads it, and no message for an internal error", async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('reviews', {});
      await client.callTool('broken', {});
      await client.callTool('expired', {});
    });

    expect(recordsIn(file).map(({ error }) => error)).toEqual([
      { code: 'REFUSED', message: 'Reviews are off\nTo fix: Turn on Reviews in Settings' },
      { code: 'TOOL_EXECUTION_ERROR' },
      { code: 'TOKEN_EXPIRED', message: 'token [REDACTED] has expired' },
    ]);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('db-pass-1');
  });

  it('records the JSON-RPC code of a tool error the client gets as a JSON-RPC error', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('long_report', {}).catch(() => undefined);
    });

    expect(recordsIn(file)[0].error).toEqual({ code: -32601, message: expect.any(String) });
  });

  it('records a task-augmented call once, with the answer of the task', async () => {
    const file = path.join(dir, 'calls.jsonl');
    const server = await createTestFetchServer({
      ...config({ path: file }),
      tasks: { enabled: true, defaultTtlMs: 60_000, defaultPollIntervalMs: 10 },
    } as FrontMcpConfigInput);
    const scope = server.instance.getScopes()[0];
    const ctx = { authInfo: { sessionId: 'recorder-task-session' } };
    const created = (await scope.runFlowForOutput('tools:call-tool', {
      request: { method: 'tools/call', params: { name: 'long_report', arguments: {}, task: { ttl: 60_000 } } },
      ctx,
    })) as unknown as { task: { taskId: string } };
    const statusOf = async () =>
      (
        (await scope.runFlowForOutput('tasks:get', {
          request: { method: 'tasks/get', params: { taskId: created.task.taskId } },
          ctx,
        })) as unknown as { status: string }
      ).status;
    for (let attempt = 0; attempt < 100 && (await statusOf()) === 'working'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await server.instance.shutdown();

    const records = recordsIn(file);
    expect(records.map(({ name, answer }) => ({ name, answer }))).toEqual([
      { name: 'long_report', answer: expect.objectContaining({ structuredContent: { done: true } }) },
    ]);
  });

  it('records resource reads and prompts, and their JSON-RPC error codes', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.readResource('notes://motd');
      await client.getPrompt('greet', { who: 'Ada' });
      await client.readResource('notes://missing').catch(() => undefined);
    });

    const records = recordsIn(file);
    expect(records.map(({ method, name, input }) => ({ method, name, input }))).toEqual([
      { method: 'resources/read', name: 'notes://motd', input: undefined },
      { method: 'prompts/get', name: 'greet', input: { who: 'Ada' } },
      { method: 'resources/read', name: 'notes://missing', input: undefined },
    ]);
    expect(records[0].answer).toEqual({ contents: [{ uri: 'notes://motd', text: 'hello' }] });
    expect(records[1].answer).toMatchObject({
      messages: [{ role: 'user', content: { type: 'text', text: 'Hello Ada' } }],
    });
    expect(records[2].error).toEqual({ code: -32002, message: 'Resource not found: notes://missing' });
  });

  it('records a resource URI without the credentials in it', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.readResource('notes://motd?access_token=tok-uri-1').catch(() => undefined);
    });

    expect(recordsIn(file)[0].name).toBe('notes://motd?access_token=[REDACTED]');
  });

  it('never writes a configured field or a credential, in the input, the answer or its JSON text', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, redactFields: ['city'] }, async (client) => {
      await client.callTool('quote', { city: 'Paris', password: 'hunter2' });
    });

    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('Paris');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('tok-secret-1');
    expect(recordsIn(file)[0].input).toEqual({ city: '[REDACTED]', password: '[REDACTED]' });
  });

  it('never writes a credential under an innocuous key, in a URL, a JWT or a session id', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('fetch_page', {
        q: 'Bearer sk-input-12345678',
        url: `https://ada:url-pass-1@example.com/feed?api_key=key-in-url-1&jwt=${JWT}`,
        headers: { Authorization: 'Basic dXNlcjpoZWFkZXItcGFzcy0x', Accept: 'text/html' },
      });
    });

    const text = fs.readFileSync(file, 'utf8');
    for (const secret of ['sk-input-12345678', 'url-pass-1', 'key-in-url-1', JWT, 'dXNlcjpoZWFkZXItcGFzcy0x']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('sk-answer-');
    expect(text).not.toContain('session-0123456789abcdef');
    expect(recordsIn(file)[0].input).toMatchObject({
      q: 'Bearer [REDACTED]',
      headers: { Authorization: '[REDACTED]', Accept: 'text/html' },
    });
  });

  it('never writes a result handle, in the folded answer or in a later call that reads it', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('big_report', {});
      await client.callTool('read_folded', { handle: HANDLE });
    });

    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain(HANDLE);
    const [folded, read] = recordsIn(file);
    expect(folded.answer).toMatchObject({ structuredContent: { handle: '[REDACTED]' } });
    expect(read.input).toEqual({ handle: '[REDACTED]' });
  });

  it('creates the recording readable by its owner only', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('lookup', { key: 'a' });
    });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('makes an existing recording readable by its owner only before it adds calls to it', async () => {
    const file = path.join(dir, 'shared.jsonl');
    fs.writeFileSync(file, '', { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    await session({ path: file }, async (client) => {
      await client.callTool('lookup', { key: 'a' });
    });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('records the calls to the app it is installed on, and not those to another app', async () => {
    const file = path.join(dir, 'calls.jsonl');
    @App({
      id: 'shop-recorded',
      name: 'Recorded',
      plugins: [CallRecorderPlugin.init({ path: file })],
      tools: [LookupTool],
    })
    class RecordedApp {}
    @App({ id: 'other', name: 'Other', tools: [OtherPingTool] })
    class OtherApp {}
    const client = await connect({
      info: { name: 'call-recorder-apps', version: '1.0.0' },
      apps: [RecordedApp, OtherApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    } as FrontMcpConfigInput);
    try {
      await client.callTool('other_ping', {});
      await client.callTool('lookup', { key: 'a' });
    } finally {
      await client.close();
    }

    expect(recordsIn(file).map(({ name }) => name)).toEqual(['lookup']);
  });

  it('records the answer the client received, after a hook replaced it', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('report', {});
    });

    expect(recordsIn(file)[0].answer).toEqual({
      content: [{ type: 'text', text: 'folded' }],
      structuredContent: { handle: 'h-1' },
    });
  });

  it('writes no line for a run that ended with neither an answer nor an error', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file }, async (client) => {
      await client.callTool('skipped', {});
      await client.callTool('report', {});
    });

    expect(recordsIn(file).map(({ name }) => name)).toEqual(['report']);
  });

  it('keeps a field named in keepFields that looks like a credential', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, keepFields: ['key'] }, async (client) => {
      await client.callTool('lookup', { key: 'user:1' });
    });

    expect(recordsIn(file)[0].input).toEqual({ key: 'user:1' });
  });

  it('records only the methods it is given, and only calls a client made', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, methods: ['tools/call'] }, async (client) => {
      await client.readResource('notes://motd');
      await client.callTool('relay', {});
    });

    expect(recordsIn(file).map(({ name }) => name)).toEqual(['relay']);
  });

  it('answers the call when the file cannot be written, and logs that once', async () => {
    const file = path.join(dir, 'taken');
    fs.mkdirSync(file);
    await session({ path: file }, async (client) => {
      const first = await client.callTool('lookup', { key: 'a' });
      const second = await client.callTool('lookup', { key: 'b' });
      expect(JSON.stringify([first, second])).toContain('"value":"v"');
    });

    expect(warnings.filter((message) => message.includes('Could not record'))).toHaveLength(1);
  });

  it('stops at maxBytes and logs that once', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, maxBytes: 1 }, async (client) => {
      await client.callTool('lookup', { key: 'a' });
      await client.callTool('lookup', { key: 'b' });
    });

    expect(recordsIn(file)).toEqual([]);
    expect(warnings.filter((message) => message.includes('maxBytes'))).toHaveLength(1);
  });

  it('counts what is in the file, also what another writer appended, against maxBytes', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, maxBytes: 4096 }, async (client) => {
      await client.callTool('lookup', { key: 'a' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      fs.appendFileSync(file, `${'x'.repeat(4096 - fs.statSync(file).size - 20)}\n`);
      await client.callTool('lookup', { key: 'b' });
    });

    expect(fs.statSync(file).size).toBe(4096 - 19);
    expect(warnings.filter((message) => message.includes('maxBytes'))).toHaveLength(1);
  });

  it('writes nothing more once the file is full', async () => {
    const file = path.join(dir, 'calls.jsonl');
    await session({ path: file, maxBytes: 1 }, async (client) => {
      await client.callTool('lookup', { key: 'a' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      await client.callTool('lookup', { key: 'b' });
    });

    expect(fs.existsSync(file)).toBe(false);
    expect(warnings.filter((message) => message.includes('maxBytes'))).toHaveLength(1);
  });

  it('refuses options it cannot honour, naming each problem', () => {
    const init = () =>
      CallRecorderPlugin.init({ path: '', methods: ['tools/list' as 'tools/call'], maxBytes: -1, redactFields: [''] });
    expect(init).toThrow(CallRecorderConfigurationError);
    expect(init).toThrow(/path: .*; methods\.0: .*; redactFields\.0: .*; maxBytes: /);
    expect(() => CallRecorderPlugin.init({ file: 'calls.jsonl' } as CallRecorderPluginOptionsInput)).toThrow(/file/);
  });
});
