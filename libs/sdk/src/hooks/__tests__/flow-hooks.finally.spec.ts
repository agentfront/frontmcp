/**
 * A stage's Finally hooks run after its Will hooks, its body and its Did hooks whatever the outcome, read why the
 * stage failed from `state.flowError`, and never change what the client gets: what one throws or responds is
 * logged and dropped.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type FlowCtxOf,
  type LogRecord,
} from '../../common';
import { PublicMcpError } from '../../errors';

const ToolHook = FlowHooksOf('tools:call-tool');
type CallToolFlow = FlowCtxOf<'tools:call-tool'>;

const trace: string[] = [];
const warnings: LogRecord[] = [];

const calling =
  (...names: string[]) =>
  (ctx: CallToolFlow) =>
    names.includes(String(ctx.state.input?.name));
const outcomeOf = (ctx: CallToolFlow) => ctx.state.flowError?.message ?? 'ok';

@LogTransport({ name: 'FinallyWarningCapture', description: 'Captures the warnings a run logs' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record);
  }
}

function postingTool(name: string, answer: unknown = { posted: true }) {
  @Tool({ name, inputSchema: {}, outputSchema: { posted: z.boolean() } })
  class PostingTool extends ToolContext {
    async execute() {
      return answer as { posted: boolean };
    }
  }
  return PostingTool;
}

@Tool({ name: 'post_crash', inputSchema: {}, outputSchema: { posted: z.boolean() } })
class PostCrashTool extends ToolContext {
  async execute(): Promise<{ posted: boolean }> {
    throw new PublicMcpError('ledger offline');
  }
}

const PostEntryTool = postingTool('post_entry');
const PostRefusedTool = postingTool('post_refused', { posted: 'yes' });

@Plugin({ name: 'ledger-finally' })
class LedgerFinallyPlugin {
  @ToolHook.Will('execute', { filter: calling('post_blocked') })
  refuse() {
    throw new PublicMcpError('blocked by policy');
  }

  @ToolHook.Will('execute', { filter: calling('post_gated') })
  closeGate(ctx: CallToolFlow) {
    ctx.fail(new PublicMcpError('gate closed'));
  }

  @ToolHook.Will('execute', { filter: calling('post_cached') })
  answerFromCache(ctx: CallToolFlow) {
    ctx.respond({ content: [{ type: 'text', text: 'from cache' }] });
  }

  @ToolHook.Around('execute', { filter: calling('post_wrapped') })
  async breakAround() {
    throw new PublicMcpError('around broke');
  }

  @ToolHook.Did('execute')
  didExecute() {
    trace.push('Did execute');
  }

  @ToolHook.Did('execute', { filter: calling('post_did_broke') })
  breakDidExecute() {
    throw new PublicMcpError('did hook broke');
  }

  @ToolHook.Finally('execute', { priority: 100 })
  lastFinallyExecute(ctx: CallToolFlow) {
    trace.push(`Finally p100 execute: ${outcomeOf(ctx)}`);
  }

  @ToolHook.Finally('execute', { priority: 0 })
  firstFinallyExecute(ctx: CallToolFlow) {
    trace.push(`Finally p0 execute: ${outcomeOf(ctx)}`);
  }

  @ToolHook.Did('finalize')
  didFinalize() {
    trace.push('Did finalize');
  }

  @ToolHook.Finally('finalize')
  finallyFinalize(ctx: CallToolFlow) {
    trace.push(`Finally finalize: ${outcomeOf(ctx)}`);
  }
}

@App({
  id: 'ledger',
  name: 'Ledger',
  plugins: [LedgerFinallyPlugin],
  tools: [
    PostEntryTool,
    PostCrashTool,
    PostRefusedTool,
    postingTool('post_blocked'),
    postingTool('post_gated'),
    postingTool('post_cached'),
    postingTool('post_wrapped'),
    postingTool('post_did_broke'),
  ],
})
class LedgerApp {}

@Plugin({ name: 'unruly-finally' })
class UnrulyFinallyPlugin {
  @ToolHook.Finally('finalize', { priority: -10 })
  hijack(ctx: CallToolFlow) {
    ctx.respond({ content: [{ type: 'text', text: 'hijacked' }] });
  }

  @ToolHook.Finally('finalize', { priority: -5 })
  explode() {
    throw new Error('finally hook broke');
  }

  @ToolHook.Finally('finalize')
  recordAfterUnruly(ctx: CallToolFlow) {
    trace.push(`Finally after unruly hooks: ${outcomeOf(ctx)}`);
  }
}

@App({
  id: 'unruly',
  name: 'Unruly',
  plugins: [UnrulyFinallyPlugin],
  tools: [PostEntryTool, PostCrashTool, PostRefusedTool],
})
class UnrulyApp {}

async function callTool(server: TestFetchServer, name: string) {
  trace.length = 0;
  const { message } = await rpc20260728(server.handler, 'tools/call', { name, arguments: {} });
  const result = message.result ?? {};
  const content = (result['content'] as Array<{ text?: string }> | undefined) ?? [];
  const resultMeta = result['_meta'] as Record<string, unknown> | undefined;
  return {
    isError: result['isError'] === true,
    text: content.map((block) => block.text ?? '').join('\n'),
    code: resultMeta?.['code'],
    structuredContent: result['structuredContent'],
    trace: [...trace],
  };
}

describe('Finally hooks', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'finally-hooks', version: '1.0.0' }, apps: [LedgerApp] });
  });

  it('run after the Did hooks of a stage that succeeded, lower priority first', async () => {
    const call = await callTool(server, 'post_entry');

    expect(call.structuredContent).toEqual({ posted: true });
    expect(call.trace).toEqual([
      'Did execute',
      'Finally p0 execute: ok',
      'Finally p100 execute: ok',
      'Did finalize',
      'Finally finalize: ok',
    ]);
  });

  it('run when the stage body fails, and read the failure from state.flowError', async () => {
    const call = await callTool(server, 'post_crash');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'ledger offline' });
    expect(call.trace).toEqual([
      'Finally p0 execute: ledger offline',
      'Finally p100 execute: ledger offline',
      'Did finalize',
      'Finally finalize: ledger offline',
    ]);
  });

  it('run when a Will hook fails the stage before its body runs', async () => {
    const call = await callTool(server, 'post_blocked');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'blocked by policy' });
    expect(call.trace).toEqual([
      'Finally p0 execute: blocked by policy',
      'Finally p100 execute: blocked by policy',
      'Did finalize',
      'Finally finalize: blocked by policy',
    ]);
  });

  it('read the error a Will hook passed to fail(), not the signal that carried it', async () => {
    const call = await callTool(server, 'post_gated');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'gate closed' });
    expect(call.trace).toEqual([
      'Finally p0 execute: gate closed',
      'Finally p100 execute: gate closed',
      'Did finalize',
      'Finally finalize: gate closed',
    ]);
  });

  it('run when a Will hook responds in place of the stage', async () => {
    const call = await callTool(server, 'post_cached');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: false, text: 'from cache' });
    expect(call.trace).toEqual([
      'Finally p0 execute: ok',
      'Finally p100 execute: ok',
      'Did finalize',
      'Finally finalize: ok',
    ]);
  });

  it('run when an Around hook fails the stage', async () => {
    const call = await callTool(server, 'post_wrapped');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'around broke' });
    expect(call.trace).toEqual([
      'Finally p0 execute: around broke',
      'Finally p100 execute: around broke',
      'Did finalize',
      'Finally finalize: around broke',
    ]);
  });

  it('run when a Did hook fails a stage whose body succeeded, and read that failure, which the client gets', async () => {
    const call = await callTool(server, 'post_did_broke');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'did hook broke' });
    expect(call.trace).toEqual([
      'Did execute',
      'Finally p0 execute: did hook broke',
      'Finally p100 execute: did hook broke',
      'Did finalize',
      'Finally finalize: did hook broke',
    ]);
  });

  it('run on finalize when the output schema refuses the answer, while Did on finalize does not', async () => {
    const call = await callTool(server, 'post_refused');

    expect({ isError: call.isError, code: call.code }).toEqual({ isError: true, code: 'INVALID_OUTPUT' });
    expect(call.trace).toEqual([
      'Did execute',
      'Finally p0 execute: ok',
      'Finally p100 execute: ok',
      'Finally finalize: Tool output validation failed (output does not match outputSchema at posted)',
    ]);
  });
});

describe('a Finally hook that responds or throws', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'unruly-finally-hooks', version: '1.0.0' },
      apps: [UnrulyApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    });
  });

  beforeEach(() => {
    warnings.length = 0;
  });

  it('leaves a successful answer as it was, and the later Finally hooks still run', async () => {
    const call = await callTool(server, 'post_entry');

    expect({ isError: call.isError, structuredContent: call.structuredContent }).toEqual({
      isError: false,
      structuredContent: { posted: true },
    });
    expect(call.trace).toEqual(['Finally after unruly hooks: ok']);
  });

  it('leaves the error of a failed call as it was', async () => {
    const call = await callTool(server, 'post_crash');

    expect({ isError: call.isError, text: call.text }).toEqual({ isError: true, text: 'ledger offline' });
    expect(call.trace).toEqual(['Finally after unruly hooks: ledger offline']);
  });

  it('leaves the refusal of an answer the output schema refuses as it was', async () => {
    const call = await callTool(server, 'post_refused');

    expect({ isError: call.isError, code: call.code }).toEqual({ isError: true, code: 'INVALID_OUTPUT' });
    expect(call.trace).toEqual([
      'Finally after unruly hooks: Tool output validation failed (output does not match outputSchema at posted)',
    ]);
  });

  it('logs what each of them threw as a warning naming the stage', async () => {
    await callTool(server, 'post_entry');

    const logged = warnings.map((record) =>
      [record.message, ...record.args].map((part) => JSON.stringify(part)).join(' '),
    );
    expect(logged).toEqual([
      expect.stringMatching(/finallyFinalize.*respond/),
      expect.stringMatching(/finallyFinalize.*finally hook broke/),
    ]);
  });
});
