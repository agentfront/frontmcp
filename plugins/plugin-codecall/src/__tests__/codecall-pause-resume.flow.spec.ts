/**
 * Pause and resume through a real server, on both runtimes: a run whose call fails input validation, or is refused by
 * a call-phase review decision, is kept `paused` before that call; `codecall:resume` runs it again from its journal,
 * once, with the calls before it answered from their recorded results, the paused call live with corrected arguments,
 * and the same clock values; `codecall:status` and `codecall:cancel` read and end it; and another instance sharing the
 * storage resumes it too.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  App,
  connect,
  InvalidInputError,
  LogLevel,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type ConnectOptions,
  type DirectClient,
} from '@frontmcp/sdk';
import { mkdtemp, rm, type StorageConfig } from '@frontmcp/utils';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';
import { KeptValueCalls } from '../kept-values/kept-value-calls';
import { callIdempotencyKey } from '../runs/call-idempotency-key';
import { CodeCallRunStoreToken, type CodeCallRunRecord } from '../runs/run-record.types';
import { RunReplay } from '../runs/run-replay';
import EnclaveService from '../services/enclave.service';

jest.setTimeout(30000);

const calls: Array<{ tool: string; args: unknown; key?: string }> = [];

function called(tool: string): number {
  return calls.filter((call) => call.tool === tool).length;
}

@Tool({ name: 'orders.get', description: 'Reads an order', inputSchema: { id: z.string() } })
class GetOrderTool extends ToolContext {
  async execute({ id }: { id: string }) {
    calls.push({ tool: 'orders.get', args: { id } });
    return { id, total: 1250 };
  }
}

@Tool({
  name: 'orders.note',
  description: 'Adds a note to an order',
  inputSchema: { id: z.string(), text: z.string() },
})
class NoteOrderTool extends ToolContext {
  async execute(args: { id: string; text: string }) {
    calls.push({ tool: 'orders.note', args });
    return { noted: true };
  }
}

let refundHeld: Promise<void> | undefined;

@Tool({
  name: 'orders.refund',
  description: 'Refunds part of an order',
  inputSchema: { id: z.string(), cents: z.number().int().positive() },
})
class RefundOrderTool extends ToolContext {
  async execute(args: { id: string; cents: number }) {
    calls.push({ tool: 'orders.refund', args, key: this.idempotencyKey });
    await refundHeld;
    return { refunded: args.cents };
  }
}

@Tool({ name: 'mail.send', description: 'Sends an email', inputSchema: { to: z.string().email() } })
class SendMailTool extends ToolContext {
  async execute(args: { to: string }) {
    calls.push({ tool: 'mail.send', args });
    return { sent: args.to };
  }
}

@Tool({
  name: 'orders.lookup',
  description: 'Looks an order up by number',
  inputSchema: { number: z.number().int().positive() },
  annotations: { readOnlyHint: true },
})
class LookupOrderTool extends ToolContext {
  async execute(args: { number: number }) {
    calls.push({ tool: 'orders.lookup', args });
    return { id: `o${args.number}` };
  }
}

@Tool({
  name: 'orders.peek',
  description: 'Peeks at an order',
  inputSchema: { id: z.string() },
  annotations: { readOnlyHint: true },
})
class PeekOrderTool extends ToolContext {
  async execute(args: { id: string }) {
    calls.push({ tool: 'orders.peek', args });
    return { id: args.id };
  }
}

@Tool({
  name: 'orders.void',
  description: 'Voids an order for good',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
})
class VoidOrderTool extends ToolContext {
  async execute(args: { id: string }) {
    calls.push({ tool: 'orders.void', args });
    return { voided: args.id };
  }
}

@Tool({ name: 'orders.strict', description: 'Refuses its input itself, after it ran', inputSchema: {} })
class StrictTool extends ToolContext {
  async execute(): Promise<never> {
    calls.push({ tool: 'orders.strict', args: {} });
    throw new InvalidInputError('The order is locked');
  }
}

@Tool({
  name: 'runs.read',
  description: "Reads a run record as the caller's owner",
  inputSchema: { runId: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class ReadRunTool extends ToolContext {
  async execute({ runId }: { runId: string }) {
    return { record: (await this.get(CodeCallRunStoreToken).read(runId, this)) ?? null };
  }
}

function serverConfig(options: CodeCallPluginOptionsInput, elicitation = false) {
  @App({
    id: 'shop',
    name: 'Shop',
    tools: [
      GetOrderTool,
      NoteOrderTool,
      RefundOrderTool,
      StrictTool,
      ReadRunTool,
      SendMailTool,
      LookupOrderTool,
      PeekOrderTool,
      VoidOrderTool,
    ],
    plugins: [CodeCallPlugin.init({ mode: 'codecall_only', ...options })],
  })
  class ShopApp {}

  return {
    info: { name: 'codecall-pause-resume', version: '1.0.0' },
    apps: [ShopApp],
    logging: { level: LogLevel.Off },
    ...(elicitation && { elicitation: { enabled: true } }),
  };
}

interface Answer {
  status: string;
  runId?: string;
  result?: unknown;
  paused?: { call: { position: number; tool: string }; expiresAt: string };
  error?: { message: string; code?: string };
  findings?: Array<{ rule: string }>;
}

function answerOf<T = Answer>(result: CallToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const [first] = result.content;
  if (first?.type !== 'text') throw new Error('the tool returned no text content');
  try {
    return JSON.parse(first.text) as T;
  } catch {
    return { status: 'error', error: { message: first.text } } as T;
  }
}

async function call<T = Answer>(client: DirectClient, tool: string, args: Record<string, unknown>): Promise<T> {
  try {
    return answerOf<T>((await client.callTool(tool, args)) as CallToolResult);
  } catch (error: unknown) {
    const { message, code } = error as { message: string; code?: string };
    return { status: 'error', error: { message, code } } as T;
  }
}

const PAUSING_SCRIPT =
  'const at = Date.now();\n' +
  "const order = await callTool('orders.get', { id: 'o1' });\n" +
  "await callTool('orders.note', { id: 'o1', text: 'refund asked' });\n" +
  "const refund = await callTool('orders.refund', { id: 'o1', cents: -order.total });\n" +
  'return { at, refund };';

let dir: string;
const clients: DirectClient[] = [];

async function open(
  config: ReturnType<typeof serverConfig>,
  session: string,
  options: Omit<ConnectOptions, 'session'> = {},
): Promise<DirectClient> {
  const client = await connect(config, { session: { id: session, user: { sub: 'ada' } }, ...options });
  clients.push(client);
  return client;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-pause-resume-'));
});

beforeEach(() => {
  calls.length = 0;
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])('pausing and resuming on the %s runtime', (runtime) => {
  const options = (storage: StorageConfig = { type: 'memory' }): CodeCallPluginOptionsInput => ({
    vm: { preset: 'secure', runtime },
    runs: { storage },
  });

  it('answers a keep and a recall before the paused call from the record, after the kept value changed', async () => {
    const client = await open(serverConfig(options()), `keep-${runtime}`);
    const keptValueCalls = jest.spyOn(KeptValueCalls.prototype, 'call');
    const script =
      "await keep('order', { id: 'o1' });\n" +
      "const kept = await recall('order');\n" +
      "const refund = await callTool('orders.refund', { id: kept.id, cents: -1 });\n" +
      'return { kept, refund };';

    const paused = await call(client, 'codecall:execute', { script });
    expect(paused).toMatchObject({ status: 'tool_error', paused: { call: { position: 3, tool: 'orders.refund' } } });
    const keptAgain = "await keep('order', { id: 'o2' });\nreturn 1;";
    expect(await call(client, 'codecall:execute', { script: keptAgain })).toMatchObject({ status: 'ok' });
    keptValueCalls.mockClear();

    const resumed = await call(client, 'codecall:resume', {
      runId: paused.runId,
      arguments: { id: 'o1', cents: 5 },
    });

    expect(resumed).toMatchObject({
      status: 'ok',
      result: { kept: { id: 'o1' }, refund: { refunded: 5 } },
      kept: ['order'],
    });
    expect(keptValueCalls).not.toHaveBeenCalled();
    const recalled = await call(client, 'codecall:execute', { script: "return await recall('order');" });
    expect(recalled).toMatchObject({ status: 'ok', result: { id: 'o2' } });
  });

  it('pauses before a call whose input is refused, and resumes it with corrected arguments, once', async () => {
    const client = await open(serverConfig(options()), `pause-${runtime}`);

    const paused = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });

    expect(paused).toMatchObject({
      status: 'tool_error',
      runId: expect.any(String),
      paused: { call: { position: 3, tool: 'orders.refund' }, expiresAt: expect.any(String) },
    });
    expect([called('orders.get'), called('orders.note'), called('orders.refund')]).toEqual([1, 1, 0]);
    const runId = paused.runId as string;
    expect(await call(client, 'codecall:status', { runId })).toMatchObject({ status: 'paused', calls: 2 });
    const record = (await call<{ record: CodeCallRunRecord }>(client, 'runs.read', { runId })).record;
    expect(record).toMatchObject({
      status: 'paused',
      clock: [expect.any(Number)],
      journal: [{ arrivedAtMs: expect.any(Number) }, { arrivedAtMs: expect.any(Number) }],
      pause: { call: { position: 3, arrivedAtMs: expect.any(Number) } },
    });

    const resumed = await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1250 } });

    expect(resumed).toMatchObject({
      status: 'ok',
      runId,
      result: { at: record.clock?.[0], refund: { refunded: 1250 } },
    });
    expect([called('orders.get'), called('orders.note'), called('orders.refund')]).toEqual([1, 1, 1]);
    expect(calls.at(-1)?.key).toBe(callIdempotencyKey(runId, 2));
    expect(await call(client, 'codecall:status', { runId })).toMatchObject({ status: 'ok', calls: 3 });

    const again = await call(client, 'codecall:resume', { runId });
    expect(again).toMatchObject({
      status: 'error',
      error: { message: expect.stringContaining('is not paused: it is ok') },
    });
    expect(called('orders.refund')).toBe(1);
  });

  it('pauses again when the resumed call is refused again, keeping the first start and the corrected arguments', async () => {
    const client = await open(serverConfig(options()), `again-${runtime}`);
    const { runId } = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });

    const second = await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 0 } });

    expect(second).toMatchObject({ status: 'tool_error', runId, paused: { call: { position: 3 } } });
    const pauseOf = async () =>
      (await call<{ record: CodeCallRunRecord }>(client, 'runs.read', { runId })).record.pause;
    expect(await pauseOf()).toMatchObject({ arguments: { id: 'o1', cents: 0 } });
    expect(await call(client, 'codecall:resume', { runId })).toMatchObject({ status: 'tool_error', paused: {} });
    expect(await pauseOf()).toMatchObject({ arguments: { id: 'o1', cents: 0 } });
    expect(await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 5 } })).toMatchObject({
      status: 'ok',
    });
    expect([called('orders.get'), called('orders.note'), called('orders.refund')]).toEqual([1, 1, 1]);
  });

  it('keeps how many lines of output the paused run wrote, and gives the resumed run each line once', async () => {
    const client = await open(serverConfig(options()), `outputs-${runtime}`);
    const script =
      "mcpLog('info', 'before');\n" +
      "const refund = await callTool('orders.refund', { id: 'o1', cents: -1 });\n" +
      "mcpLog('info', 'after');\nreturn refund.refunded;";
    const { runId } = await call(client, 'codecall:execute', { script });
    const record = (await call<{ record: CodeCallRunRecord }>(client, 'runs.read', { runId })).record;
    expect(record).toMatchObject({ status: 'paused', outputs: 1 });

    const resumed = await call<Answer & { logs?: string[] }>(client, 'codecall:resume', {
      runId,
      arguments: { id: 'o1', cents: 3 },
    });

    expect(resumed).toMatchObject({ status: 'ok', result: 3, logs: ['[mcp:info] before', '[mcp:info] after'] });
  });

  it('lets one of two resumes at once run the run', async () => {
    const client = await open(serverConfig(options()), `race-${runtime}`);
    const { runId } = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });

    const answers = await Promise.all(
      [1, 2].map(() => call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1 } })),
    );

    expect(answers.map((answer) => answer.status).sort()).toEqual(['error', 'ok']);
    expect(called('orders.refund')).toBe(1);
  });

  it('does not pause when the tool ran and refused its input itself, or the script caught the refusal', async () => {
    const client = await open(serverConfig(options()), `no-pause-${runtime}`);

    const ranTool = await call(client, 'codecall:execute', {
      script: "await callTool('orders.get', { id: 'o1' });\nreturn await callTool('orders.strict', {});",
    });
    const caught = await call(client, 'codecall:execute', {
      script:
        "const refund = await callTool('orders.refund', { id: 'o1', cents: -1 }, { throwOnError: false });\n" +
        'return refund.success;',
    });

    expect(ranTool).toMatchObject({ status: 'tool_error', error: { code: 'VALIDATION' } });
    expect(ranTool).not.toHaveProperty('paused');
    expect(caught).toMatchObject({ status: 'ok', result: false });
    expect(caught).not.toHaveProperty('paused');
  });

  it('answers not found after the wait, to another owner, and for a cancelled run it says so', async () => {
    const config = serverConfig({ ...options(), runs: { storage: { type: 'memory' }, pause: { waitSeconds: 60 } } });
    const client = await open(config, `limits-${runtime}`);
    const stranger = await open(config, `stranger-${runtime}`);
    const expiring = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });
    const cancelled = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });

    expect(await call(stranger, 'codecall:resume', { runId: expiring.runId })).toMatchObject({
      error: { message: expect.stringContaining('was not found') },
    });
    expect(await call(client, 'codecall:cancel', { runId: cancelled.runId })).toMatchObject({ status: 'cancelled' });
    expect(await call(client, 'codecall:resume', { runId: cancelled.runId })).toMatchObject({
      error: { message: expect.stringContaining('is not paused: it is cancelled') },
    });

    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect(await call(client, 'codecall:resume', { runId: expiring.runId })).toMatchObject({
      error: { message: expect.stringContaining('was not found') },
    });
    expect(called('orders.refund')).toBe(0);
  });

  it('pauses before a call a call-phase review decision refused, and reviews it again on resume', async () => {
    const client = await open(serverConfig({ ...options(), review: {} }), `review-${runtime}`);
    const script =
      "const order = await callTool('orders.get', { id: 'o1' });\n" +
      "return await callTool('orders.refund', { id: 'o1', cents: String(order.total) });";

    const paused = await call(client, 'codecall:execute', { script });

    expect(paused).toMatchObject({ status: 'needs_changes', paused: { call: { position: 2, tool: 'orders.refund' } } });
    expect(
      await call(client, 'codecall:resume', { runId: paused.runId, arguments: { id: 'o1', cents: 'x' } }),
    ).toMatchObject({ status: 'needs_changes', paused: { call: { position: 2 } } });
    expect(
      await call(client, 'codecall:resume', { runId: paused.runId, arguments: { id: 'o1', cents: 1250 } }),
    ).toMatchObject({ status: 'ok', result: { refunded: 1250 } });
    expect([called('orders.get'), called('orders.refund')]).toEqual([1, 1]);
  });
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])('resuming safely on the %s runtime', (runtime) => {
  const vm = { preset: 'secure' as const, runtime };

  it("puts corrected arguments before the server's reviewers before it claims the run", async () => {
    const reviewer = jest.fn(({ code }: { code: string }) =>
      code.includes('evil.com')
        ? { decision: 'denied' as const, reason: 'Mail goes to our own domain only' }
        : { decision: 'allow' as const },
    );
    const client = await open(
      serverConfig({ vm, runs: { storage: { type: 'memory' } }, review: { reviewer, policy: 'Own mail' } }),
      `reviewers-${runtime}`,
    );
    const paused = await call(client, 'codecall:execute', {
      script: "return await callTool('mail.send', { to: 'ops' });",
    });
    expect(paused).toMatchObject({ status: 'tool_error', paused: { call: { position: 1, tool: 'mail.send' } } });

    const refused = await call(client, 'codecall:resume', { runId: paused.runId, arguments: { to: 'x@evil.com' } });

    expect(refused).toMatchObject({
      status: 'denied',
      reason: 'Mail goes to our own domain only',
      runId: paused.runId,
    });
    expect(called('mail.send')).toBe(0);
    expect(await call(client, 'codecall:status', { runId: paused.runId })).toMatchObject({ status: 'paused' });
    expect(
      await call(client, 'codecall:resume', { runId: paused.runId, arguments: { to: 'ops@example.com' } }),
    ).toMatchObject({
      status: 'ok',
      result: { sent: 'ops@example.com' },
    });
  });

  it('refuses up front to resume a run whose replay needs replayed calls on an Enclave without them, and keeps it paused', async () => {
    jest.spyOn(RunReplay.prototype, 'needsCallTimes').mockReturnValue(true);
    const client = await open(serverConfig({ vm, runs: { storage: { type: 'memory' } } }), `needs-times-${runtime}`);
    const { runId } = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });
    jest.restoreAllMocks();
    const replaysCallTimes = jest.spyOn(EnclaveService.prototype, 'replaysCallTimes').mockResolvedValue(false);

    const refused = await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1 } });

    expect(refused).toMatchObject({
      error: { message: expect.stringContaining('needs @enclave-vm/core 2.21.1 or later') },
    });
    expect(await call(client, 'codecall:status', { runId })).toMatchObject({ status: 'paused' });
    expect(called('orders.refund')).toBe(0);
    replaysCallTimes.mockResolvedValue(true);
    expect(await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1 } })).toMatchObject({
      status: 'ok',
    });
  });

  it('keeps the run resuming while a resume runs it, so a second resume is refused', async () => {
    const client = await open(serverConfig({ vm, runs: { storage: { type: 'memory' } } }), `resuming-${runtime}`);
    const { runId } = await call(client, 'codecall:execute', { script: PAUSING_SCRIPT });
    let release: () => void = () => undefined;
    refundHeld = new Promise((resolve) => {
      release = resolve;
    });

    const first = call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1 } });
    let firstEnded = false;
    void first.then(() => {
      firstEnded = true;
    });
    try {
      const deadline = Date.now() + 10_000;
      while (called('orders.refund') === 0 && !firstEnded && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(called('orders.refund')).toBe(1);
      const status = await call(client, 'codecall:status', { runId });
      const second = await call(client, 'codecall:resume', { runId, arguments: { id: 'o1', cents: 1 } });

      expect(status).toMatchObject({ status: 'resuming' });
      expect(second).toMatchObject({ error: { message: expect.stringContaining('is not paused: it is resuming') } });
    } finally {
      release();
      refundHeld = undefined;
    }
    expect(await first).toMatchObject({ status: 'ok' });
    expect(called('orders.refund')).toBe(1);
  });

  it('resumes an approval asked through elicitation from the attempt that stopped, not from the paused record', async () => {
    const onElicitation = jest.fn(async () => ({ action: 'accept' as const, content: { approve: true } }));
    const config = serverConfig({ vm, runs: { storage: { type: 'memory' } }, review: {} }, true);
    const client = await open(config, `elicited-${runtime}`, { onElicitation });
    const script =
      "const order = await callTool('orders.lookup', { number: -1 });\n" +
      "const seen = await callTool('orders.peek', { id: order.id });\n" +
      "return await callTool('orders.void', { id: 'o' + seen.id.length });";
    const paused = await call(client, 'codecall:execute', { script });
    expect(paused).toMatchObject({ paused: { call: { position: 1, tool: 'orders.lookup' } } });

    const resumed = await call(client, 'codecall:resume', { runId: paused.runId, arguments: { number: 7 } });

    expect(resumed).toMatchObject({ status: 'ok', result: { voided: 'o2' } });
    expect(onElicitation).toHaveBeenCalledTimes(1);
    expect([called('orders.lookup'), called('orders.peek'), called('orders.void')]).toEqual([1, 1, 1]);
  });
});

describe('resuming on another instance that shares the storage', () => {
  it('resumes a run another instance paused, without calling the recorded tools again', async () => {
    const storage: StorageConfig = { type: 'sqlite', sqlite: { path: join(dir, 'shared-runs.sqlite') } };
    const options: CodeCallPluginOptionsInput = { vm: { preset: 'secure', runtime: 'interpreter' }, runs: { storage } };
    const first = await open(serverConfig(options), 'shared-session');
    const second = await open(serverConfig(options), 'shared-session');

    const paused = await call(first, 'codecall:execute', { script: PAUSING_SCRIPT });
    const resumed = await call(second, 'codecall:resume', { runId: paused.runId, arguments: { id: 'o1', cents: 7 } });

    expect(resumed).toMatchObject({ status: 'ok', runId: paused.runId, result: { refund: { refunded: 7 } } });
    expect([called('orders.get'), called('orders.note'), called('orders.refund')]).toEqual([1, 1, 1]);
    expect(await call(first, 'codecall:resume', { runId: paused.runId })).toMatchObject({ status: 'error' });
  });
});
