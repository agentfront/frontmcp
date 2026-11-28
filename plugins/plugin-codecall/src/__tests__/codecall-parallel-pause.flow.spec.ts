/**
 * Pause and resume inside `parallel()`, through a real server, on both runtimes: a call that needs approval, or whose
 * input is refused, stops the run once the other calls of the `parallel()` finished; they are recorded with their
 * results, and `codecall:resume` answers them from the record and runs only the paused call. No tool runs twice, with
 * several calls that need approval, with an approval a person refused, and when a call does not finish in time.
 */
import 'reflect-metadata';

import { ApprovalPlugin, ApprovalScope, ApprovalStoreToken } from '@frontmcp/plugin-approval';
import {
  App,
  connect,
  LogLevel,
  Tool,
  ToolContext,
  z,
  type CallToolResult,
  type ConnectOptions,
  type DirectClient,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput, CodeCallVmRuntime } from '../codecall.types';
import { callIdempotencyKey } from '../runs/call-idempotency-key';
import { CodeCallRunStoreToken, type CodeCallRunRecord } from '../runs/run-record.types';

jest.setTimeout(30000);

const calls: Array<{ tool: string; id: string; key?: string }> = [];

function ran(tool: string, id?: string): number {
  return calls.filter((call) => call.tool === tool && (id === undefined || call.id === id)).length;
}

/** How long each order's note takes: the later orders' notes are still running when the third call is decided. */
const NOTE_DELAY_MS: Record<string, number> = { o1: 5, o2: 10, o4: 60, o5: 90 };

@Tool({ name: 'orders.note', description: 'Adds a note to an order', inputSchema: { id: z.string() } })
class NoteOrderTool extends ToolContext {
  async execute({ id }: { id: string }) {
    await new Promise((resolve) => setTimeout(resolve, NOTE_DELAY_MS[id] ?? 1));
    calls.push({ tool: 'orders.note', id, key: this.idempotencyKey });
    return { noted: id };
  }
}

@Tool({
  name: 'orders.refund',
  description: 'Refunds part of an order',
  inputSchema: { id: z.string(), cents: z.number().int().positive() },
})
class RefundOrderTool extends ToolContext {
  async execute({ id, cents }: { id: string; cents: number }) {
    await new Promise((resolve) => setTimeout(resolve, NOTE_DELAY_MS[id] ?? 1));
    calls.push({ tool: 'orders.refund', id });
    return { refunded: cents };
  }
}

@Tool({
  name: 'orders.void',
  description: 'Voids an order for good',
  inputSchema: { id: z.string() },
  annotations: { destructiveHint: true },
})
class VoidOrderTool extends ToolContext {
  async execute({ id }: { id: string }) {
    calls.push({ tool: 'orders.void', id, key: this.idempotencyKey });
    return { voided: id };
  }
}

@Tool({ name: 'orders.export', description: 'Exports an order, slowly', inputSchema: { id: z.string() } })
class ExportOrderTool extends ToolContext {
  async execute({ id }: { id: string }) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    calls.push({ tool: 'orders.export', id });
    return { exported: id };
  }
}

@Tool({
  name: 'approvals.grant',
  description: 'Grants a CodeCall approval for this session, as a person would through the server',
  inputSchema: { id: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class GrantApprovalTool extends ToolContext {
  async execute({ id }: { id: string }) {
    await this.approval.grantSessionApproval(id);
    return { granted: id };
  }
}

@Tool({
  name: 'approvals.deny',
  description: 'Refuses a CodeCall approval for this session, as a person would through the server',
  inputSchema: { id: z.string() },
  codecall: { visibleInListTools: true, enabledInCodeCall: false },
})
class DenyApprovalTool extends ToolContext {
  async execute({ id }: { id: string }) {
    const sessionId = this.tryGetContext()?.verifiedSessionId;
    await this.get(ApprovalStoreToken).denyApproval?.({ toolId: id, scope: ApprovalScope.SESSION, sessionId });
    return { denied: id };
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
      NoteOrderTool,
      RefundOrderTool,
      VoidOrderTool,
      ExportOrderTool,
      GrantApprovalTool,
      DenyApprovalTool,
      ReadRunTool,
    ],
    plugins: [
      CodeCallPlugin.init({ mode: 'codecall_only', runs: { storage: { type: 'memory' } }, ...options }),
      ApprovalPlugin.init({ storage: { type: 'memory' } }),
    ],
  })
  class ShopApp {}

  return {
    info: { name: 'codecall-parallel-pause', version: '1.0.0' },
    apps: [ShopApp],
    logging: { level: LogLevel.Off },
    ...(elicitation && { elicitation: { enabled: true } }),
  };
}

interface Answer {
  status: string;
  runId?: string;
  result?: unknown;
  reason?: string;
  approval?: { id: string; toolName?: string };
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

async function readRun(client: DirectClient, runId: string): Promise<CodeCallRunRecord> {
  return (await call<{ record: CodeCallRunRecord }>(client, 'runs.read', { runId })).record;
}

/**
 * Five calls at once: a note on each order but the ones in `voided`, which are voided, a destructive call that needs a
 * person's approval at the call (its argument is computed, so the script's review cannot ask for it up front).
 */
function fiveCalls(voided: string[]): string {
  return (
    `const voided = ${JSON.stringify(voided)};\n` +
    "const orders = ['o1', 'o2', 'o3', 'o4', 'o5'];\n" +
    'return await parallel(orders, (id) =>\n' +
    "  voided.includes(id) ? callTool('orders.void', { id }) : callTool('orders.note', { id }),\n" +
    ');'
  );
}

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

beforeEach(() => {
  calls.length = 0;
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe.each<CodeCallVmRuntime>(['node-vm', 'interpreter'])(
  'pausing inside parallel() on the %s runtime',
  (runtime) => {
    const vm = { preset: 'secure' as const, runtime };
    const reviewed = (options: CodeCallPluginOptionsInput = {}) => serverConfig({ vm, review: {}, ...options });

    it('lets the other calls finish, then runs only the third once a person approves it, with every result in place', async () => {
      const client = await open(reviewed(), `third-${runtime}`);

      const paused = await call(client, 'codecall:execute', { script: fiveCalls(['o3']) });

      expect(paused).toMatchObject({
        status: 'needs_approval',
        approval: { toolName: 'orders.void' },
        paused: { call: { position: 3, tool: 'orders.void' } },
      });
      expect(['o1', 'o2', 'o4', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1, 1]);
      expect(ran('orders.void')).toBe(0);
      const runId = paused.runId as string;
      const record = await readRun(client, runId);
      expect(record.journal.map((entry) => [entry.position, entry.outcome, entry.result])).toEqual([
        [1, 'success', { noted: 'o1' }],
        [2, 'success', { noted: 'o2' }],
        [4, 'success', { noted: 'o4' }],
        [5, 'success', { noted: 'o5' }],
      ]);

      await call(client, 'approvals.grant', { id: paused.approval?.id as string });
      const resumed = await call(client, 'codecall:resume', { runId });

      expect(resumed).toMatchObject({
        status: 'ok',
        runId,
        result: [{ noted: 'o1' }, { noted: 'o2' }, { voided: 'o3' }, { noted: 'o4' }, { noted: 'o5' }],
      });
      expect(['o1', 'o2', 'o4', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1, 1]);
      expect(calls.filter((entry) => entry.tool === 'orders.void')).toEqual([
        { tool: 'orders.void', id: 'o3', key: callIdempotencyKey(runId, 2) },
      ]);
      expect(await call(client, 'codecall:status', { runId })).toMatchObject({ status: 'ok', calls: 5 });
    });

    it('pauses at the first of several calls that need approval, then at the next, and runs each call once', async () => {
      const client = await open(reviewed(), `several-${runtime}`);

      const first = await call(client, 'codecall:execute', { script: fiveCalls(['o2', 'o4']) });

      expect(first).toMatchObject({ status: 'needs_approval', paused: { call: { position: 2, tool: 'orders.void' } } });
      expect(['o1', 'o3', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1]);
      expect(ran('orders.void')).toBe(0);
      const runId = first.runId as string;

      await call(client, 'approvals.grant', { id: first.approval?.id as string });
      const second = await call(client, 'codecall:resume', { runId });

      expect(second).toMatchObject({ status: 'needs_approval', runId, paused: { call: { position: 4 } } });
      expect([ran('orders.void', 'o2'), ran('orders.void', 'o4')]).toEqual([1, 0]);
      expect(second.approval?.id).not.toBe(first.approval?.id);

      await call(client, 'approvals.grant', { id: second.approval?.id as string });
      const done = await call(client, 'codecall:resume', { runId });

      expect(done).toMatchObject({
        status: 'ok',
        result: [{ noted: 'o1' }, { voided: 'o2' }, { noted: 'o3' }, { voided: 'o4' }, { noted: 'o5' }],
      });
      expect(['o1', 'o3', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1]);
      expect([ran('orders.void', 'o2'), ran('orders.void', 'o4')]).toEqual([1, 1]);
    });

    it('answers denied when a person refused the approval, without running the call or its siblings again', async () => {
      const client = await open(reviewed(), `denied-${runtime}`);
      const paused = await call(client, 'codecall:execute', { script: fiveCalls(['o3']) });
      expect(paused.paused).toMatchObject({ call: { position: 3 } });

      await call(client, 'approvals.deny', { id: paused.approval?.id as string });
      const refused = await call(client, 'codecall:resume', { runId: paused.runId });

      expect(refused).toMatchObject({
        status: 'denied',
        reason: expect.stringContaining('a person refused the approval'),
        runId: paused.runId,
      });
      expect(ran('orders.void')).toBe(0);
      expect(['o1', 'o2', 'o4', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1, 1]);
    });

    it('answers denied when the person asked through elicitation declines, after the other calls ran once', async () => {
      const onElicitation = jest.fn(async () => ({ action: 'decline' as const }));
      const client = await open(serverConfig({ vm, review: {} }, true), `declined-${runtime}`, { onElicitation });

      const outcome = await call(client, 'codecall:execute', { script: fiveCalls(['o3']) });

      expect(outcome).toMatchObject({
        status: 'denied',
        reason: expect.stringContaining('the person did not approve it'),
      });
      expect(onElicitation).toHaveBeenCalledTimes(1);
      expect(ran('orders.void')).toBe(0);
      expect(['o1', 'o2', 'o4', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1, 1]);
    });

    it('runs only the third call once the person asked through elicitation approves it', async () => {
      const onElicitation = jest.fn(async () => ({ action: 'accept' as const, content: { approve: true } }));
      const client = await open(serverConfig({ vm, review: {} }, true), `approved-${runtime}`, { onElicitation });

      const outcome = await call(client, 'codecall:execute', { script: fiveCalls(['o3']) });

      expect(outcome).toMatchObject({ status: 'ok', result: expect.arrayContaining([{ voided: 'o3' }]) });
      expect(onElicitation).toHaveBeenCalledTimes(1);
      expect(['o1', 'o2', 'o4', 'o5'].map((id) => ran('orders.note', id))).toEqual([1, 1, 1, 1]);
      expect(ran('orders.void', 'o3')).toBe(1);
    });

    it('pauses at a call whose input is refused, and resumes it with corrected arguments without the others', async () => {
      const client = await open(serverConfig({ vm }), `input-${runtime}`);
      const script =
        'const cents = { o1: 100, o2: 200, o3: -300, o4: 400, o5: 500 };\n' +
        "return await parallel(['o1', 'o2', 'o3', 'o4', 'o5'], (id) => callTool('orders.refund', { id, cents: cents[id] }));";

      const paused = await call(client, 'codecall:execute', { script });

      // A failed parallel() ends the script with its first failure on node-vm, and with its list of failures on the interpreter.
      expect(paused).toMatchObject({
        status: runtime === 'node-vm' ? 'tool_error' : 'runtime_error',
        paused: { call: { position: 3, tool: 'orders.refund' } },
      });
      expect(['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ran('orders.refund', id))).toEqual([1, 1, 0, 1, 1]);

      const resumed = await call(client, 'codecall:resume', {
        runId: paused.runId,
        arguments: { id: 'o3', cents: 300 },
      });

      expect(resumed).toMatchObject({
        status: 'ok',
        result: [{ refunded: 100 }, { refunded: 200 }, { refunded: 300 }, { refunded: 400 }, { refunded: 500 }],
      });
      expect(['o1', 'o2', 'o3', 'o4', 'o5'].map((id) => ran('orders.refund', id))).toEqual([1, 1, 1, 1, 1]);
    });

    it('does not pause when a call beside it outlives the script timeout, and never runs the paused call', async () => {
      const client = await open(reviewed({ vm: { ...vm, timeoutMs: 600 } }), `timeout-${runtime}`);
      const script =
        "const voided = 'o' + 3;\n" +
        "return await parallel(['o1', 'o2', 'o3'], (id) =>\n" +
        "  id === voided ? callTool('orders.void', { id }) : id === 'o2' ? callTool('orders.export', { id }) : callTool('orders.note', { id }),\n" +
        ');';

      const outcome = await call(client, 'codecall:execute', { script });

      expect(outcome).toMatchObject({
        status: 'timeout',
        error: { message: expect.stringContaining('1 tool call was') },
      });
      expect(outcome).not.toHaveProperty('paused');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect([ran('orders.note', 'o1'), ran('orders.export', 'o2'), ran('orders.void')]).toEqual([1, 1, 0]);
    });

    it('stops waiting before the review hook would time out, and does not pause beside a call still running', async () => {
      const client = await open(reviewed({ review: { timeoutMs: 400 } }), `hook-timeout-${runtime}`);
      const script =
        "const voided = 'o' + 3;\n" +
        "return await parallel(['o1', 'o2', 'o3'], (id) =>\n" +
        "  id === voided ? callTool('orders.void', { id }) : id === 'o2' ? callTool('orders.export', { id }) : callTool('orders.note', { id }),\n" +
        ');';

      const outcome = await call(client, 'codecall:execute', { script });

      // orders.export has effects and may still complete: approving would run it again, so the call needs its own script.
      expect(outcome).toMatchObject({ status: 'needs_changes', findings: [{ rule: 'approval-after-effects' }] });
      expect(outcome).not.toHaveProperty('paused');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect([ran('orders.note', 'o1'), ran('orders.export', 'o2'), ran('orders.void')]).toEqual([1, 1, 0]);
    });

    it('answers that a paused parallel() run past its wait is not found, and runs nothing', async () => {
      const client = await open(
        reviewed({ runs: { storage: { type: 'memory' }, pause: { waitSeconds: 60 } } }),
        `wait-${runtime}`,
      );
      const paused = await call(client, 'codecall:execute', { script: fiveCalls(['o3']) });
      await call(client, 'approvals.grant', { id: paused.approval?.id as string });

      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
      const late = await call(client, 'codecall:resume', { runId: paused.runId });

      expect(late).toMatchObject({ error: { message: expect.stringContaining('was not found') } });
      expect(ran('orders.void')).toBe(0);
      expect(ran('orders.note')).toBe(4);
    });
  },
);
