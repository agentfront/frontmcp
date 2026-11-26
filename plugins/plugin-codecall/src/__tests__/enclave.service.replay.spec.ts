/**
 * Replay on Enclave's real runtimes: a recorded run answers its calls from its journal without calling the tools, its
 * script reads the same clock and random values, the calls past the journal run live, and a script that makes another
 * call at a recorded position, or ends before its recorded calls, ends with a divergence, unless the sandbox stopped it
 * or refused a call the script caught.
 */
import { AgentScriptRunner } from '@enclave-vm/core/worker';

import type { CodeCallVmEnvironment } from '../codecall.symbol';
import CodeCallConfig from '../providers/code-call.config';
import { RunJournal } from '../runs/run-journal';
import type { CodeCallRunRecord } from '../runs/run-record.types';
import { RunReplay, type RunReplaySource } from '../runs/run-replay';
import EnclaveService from '../services/enclave.service';
import { createDefaultRuntimes } from '../services/runtime';
import { createInterpreterRuntime } from '../services/runtime/interpreter.runtime';

jest.setTimeout(30000);

const SCRIPT = `
const startedAt = Date.now();
const pick = Math.random();
const ticket = await callTool('tickets.read', { id: 7 });
mcpLog('info', 'read ticket ' + ticket.name);
const failed = await callTool('tickets.lock', { id: 7 }, { throwOnError: false });
const tagged = await callTool('tickets.tag', { label: ticket.name, pick });
return { startedAt, pick, ticket, failed: failed.error.message, tagged, later: Date.now() >= startedAt };
`;

function environment() {
  const callTool = jest.fn(async (name: string, ..._rest: unknown[]): Promise<unknown> => {
    if (name === 'tickets.read') return { name: 'Ada' };
    if (name === 'tickets.lock') throw Object.freeze({ code: 'EXECUTION', message: 'Locked', toolName: name });
    return { tagged: true };
  });
  const mcpLog = jest.fn();
  const env = { callTool, getTool: jest.fn(), mcpLog, mcpNotify: jest.fn() } as unknown as CodeCallVmEnvironment;
  return Object.assign(env, { callTool, mcpLog });
}

function serviceFor(
  runtime: 'node-vm' | 'interpreter',
  runtimes = createDefaultRuntimes(),
  limits: { maxToolCalls?: number } = {},
): EnclaveService {
  return new EnclaveService(
    new CodeCallConfig({ vm: { preset: 'secure', runtime, timeoutMs: 5000, ...limits } }),
    undefined,
    runtimes,
  );
}

function recordingJournal(source?: RunReplaySource): RunJournal {
  return new RunJournal({ keepResults: true, replay: new RunReplay(source) });
}

/** The parts of a run record a replay reads. */
function sourceOf(journal: RunJournal): RunReplaySource {
  return { journal: [...journal.close()], ...journal.replay?.recordedReads() } as Pick<CodeCallRunRecord, 'journal'>;
}

describe.each(['node-vm', 'interpreter'] as const)('replaying a run on the %s runtime', (runtime) => {
  const service = serviceFor(runtime);

  async function recordedRun() {
    const env = environment();
    const journal = recordingJournal();
    const result = await service.execute(SCRIPT, env, journal);
    return { env, result, source: sourceOf(journal) };
  }

  it('records each call with its result or error, and what the script read from the clock and random', async () => {
    const { result, source } = await recordedRun();

    expect(result).toMatchObject({ success: true, result: { ticket: { name: 'Ada' }, failed: 'Locked' } });
    expect(source.journal.map(({ tool, outcome }) => [tool, outcome])).toEqual([
      ['tickets.read', 'success'],
      ['tickets.lock', 'failure'],
      ['tickets.tag', 'success'],
    ]);
    expect(source.journal[1].error).toEqual({ code: 'EXECUTION', message: 'Locked' });
    expect(source.clock).toHaveLength(2);
    expect(source.random).toHaveLength(1);
  });

  it('answers every recorded call from the journal, reads the same values, and writes its log line once', async () => {
    const first = await recordedRun();
    const env = environment();
    const journal = recordingJournal(first.source);

    const replayed = await service.execute(SCRIPT, env, journal);

    expect(replayed).toEqual({ ...first.result, stats: expect.any(Object) });
    expect(env.callTool).not.toHaveBeenCalled();
    expect(env.mcpLog).not.toHaveBeenCalled();
    expect(replayed.logs).toEqual(['[mcp:info] read ticket Ada']);
    expect(sourceOf(journal)).toEqual({
      ...first.source,
      journal: first.source.journal.map((entry) => ({ ...entry, durationMs: expect.any(Number) })),
    });
  });

  it('runs the calls past the journal live, after the recorded ones', async () => {
    const first = await recordedRun();
    const env = environment();
    const paused = { ...first.source, journal: first.source.journal.slice(0, 2) };

    const resumed = await service.execute(SCRIPT, env, recordingJournal(paused));

    expect(resumed).toMatchObject({ success: true, result: first.result.result });
    expect(env.callTool.mock.calls.map(([name, args, , call]) => [name, args, call])).toEqual([
      ['tickets.tag', { label: 'Ada', pick: (first.result.result as { pick: number }).pick }, { callIndex: 2 }],
    ]);
  });

  it('ends with a divergence when the script makes another call at a recorded position', async () => {
    const first = await recordedRun();
    const env = environment();
    const changed = SCRIPT.replace("callTool('tickets.read', { id: 7 })", "callTool('tickets.read', { id: 8 })");

    const diverged = await service.execute(changed, env, recordingJournal(first.source));

    expect(diverged).toMatchObject({
      success: false,
      error: {
        name: 'RunDivergedError',
        code: 'RUN_DIVERGED',
        message: 'The run diverged from its journal: call 1 to "tickets.read" had other arguments',
      },
    });
    expect(env.callTool).not.toHaveBeenCalled();
  });

  it('ends with the refusal, not a divergence, when the sandbox stops the script before its recorded calls', async () => {
    const first = await recordedRun();
    const env = environment();

    const refused = await serviceFor(runtime, createDefaultRuntimes(), { maxToolCalls: 1 }).execute(
      SCRIPT,
      env,
      recordingJournal(first.source),
    );

    expect(refused).toMatchObject({
      success: false,
      error: { message: expect.stringContaining('Maximum tool call limit exceeded (1)') },
    });
    expect(refused.error?.code).not.toBe('RUN_DIVERGED');
    expect(env.callTool).not.toHaveBeenCalled();
  });

  it('ends with the refusal when the script caught it and returned before its recorded calls', async () => {
    const first = await recordedRun();
    const caught = `try {\n${SCRIPT}\n} catch (error) {\n  return 'caught';\n}`;

    const refused = await serviceFor(runtime, createDefaultRuntimes(), { maxToolCalls: 1 }).execute(
      caught,
      environment(),
      recordingJournal(first.source),
    );

    expect(refused).toMatchObject({
      success: false,
      error: {
        name: 'CallRefusedError',
        code: 'MAX_TOOL_CALLS_EXCEEDED',
        message:
          'The sandbox refused a call (MAX_TOOL_CALLS_EXCEEDED); the script caught it and ended before the calls its run made',
      },
    });
  });

  it("ends with a divergence when the script throws a refusal's words itself: only Enclave's result names one", async () => {
    const first = await recordedRun();
    const forged = `throw new Error('Suspicious pattern detected: forged [EXFIL_LIST_SEND]');\n${SCRIPT}`;

    const diverged = await service.execute(forged, environment(), recordingJournal(first.source));

    expect(diverged).toMatchObject({ success: false, error: { code: 'RUN_DIVERGED' } });
  });

  it('ends with a divergence when the script itself ends before its recorded calls', async () => {
    const first = await recordedRun();

    const diverged = await service.execute(
      `throw new Error('Stopped early');\n${SCRIPT}`,
      environment(),
      recordingJournal(first.source),
    );

    expect(diverged).toMatchObject({
      success: false,
      error: {
        code: 'RUN_DIVERGED',
        message: 'The run diverged from its journal: script ended before call 3, which its run made',
      },
    });
  });

  it('keeps the review decisions of a run that diverged', async () => {
    const first = await recordedRun();
    const changed = SCRIPT.replace("callTool('tickets.read', { id: 7 })", "callTool('tickets.read', { id: 8 })");
    const review = { hooks: { pre: async () => ({ decision: 'allow' as const }) }, context: {} };

    const diverged = await service.execute(changed, environment(), recordingJournal(first.source), review);

    expect(diverged).toMatchObject({ success: false, error: { code: 'RUN_DIVERGED' } });
    expect(diverged.review?.decisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: 'call', callIndex: 0, decision: 'allow' })]),
    );
  });
});

describe('a runtime that cannot replay', () => {
  class RunnerWithoutReplay extends AgentScriptRunner {
    static override readonly capabilities = AgentScriptRunner.capabilities.filter(
      (capability) => capability !== 'replay',
    );
  }
  const runtimes = {
    ...createDefaultRuntimes(),
    interpreter: createInterpreterRuntime(async () => ({ AgentScriptRunner: RunnerWithoutReplay })),
  };
  const service = serviceFor('interpreter', runtimes);

  it('runs the script as before and records nothing to replay', async () => {
    const journal = recordingJournal();

    const result = await service.execute(SCRIPT, environment(), journal);

    expect(result.success).toBe(true);
    expect(journal.replay?.recordedReads()).toEqual({});
  });

  it('refuses to replay a run, before any of it runs', async () => {
    const env = environment();
    const source: RunReplaySource = { journal: [] };

    const result = await service.execute(SCRIPT, env, recordingJournal(source));

    expect(result).toMatchObject({ success: false, error: { code: 'RUNTIME_FEATURE_UNSUPPORTED' } });
    expect(env.callTool).not.toHaveBeenCalled();
  });
});
