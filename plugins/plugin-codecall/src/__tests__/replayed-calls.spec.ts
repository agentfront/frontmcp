/**
 * Enclave's `replayedCalls` run option (2.21.1): a resumed run gives each runtime its recorded calls with when they first
 * reached the host, where the runtime takes it, and then needs no detector guard to pause; elsewhere the guard stays.
 */
import CodeCallConfig from '../providers/code-call.config';
import { argumentsHashOf } from '../runs/run-journal';
import type { CodeCallJournalEntry } from '../runs/run-record.types';
import { RunReplay, type RunReplaySource } from '../runs/run-replay';
import EnclaveService from '../services/enclave.service';
import { AGENT_SCRIPT_RUNNER_EXPORT, createInterpreterRuntime } from '../services/runtime/interpreter.runtime';
import { createNodeVmRuntime, supportsReplayedCalls } from '../services/runtime/node-vm.runtime';
import type { CodeCallScriptRunSpec } from '../services/runtime/runtime.types';

function entry(position: number, tool: string, arrivedAtMs?: number): CodeCallJournalEntry {
  return {
    position,
    tool,
    argumentsHash: argumentsHashOf({}),
    outcome: 'success',
    durationMs: 1,
    result: {},
    ...(arrivedAtMs !== undefined && { arrivedAtMs }),
  };
}

const timed: RunReplaySource = { journal: [entry(1, 'orders.list', 10), entry(2, 'mail.send', 7_000)] };
const replayedCalls = [
  { callIndex: 0, toolName: 'orders.list', elapsedMs: 10 },
  { callIndex: 1, toolName: 'mail.send', elapsedMs: 7_000 },
];

function spec(overrides: Partial<CodeCallScriptRunSpec> = {}): CodeCallScriptRunSpec {
  return {
    timeoutMs: 1000,
    maxIterations: 10000,
    maxToolCalls: 7,
    maxSanitizeDepth: 20,
    maxSanitizeProperties: 500,
    toolHandler: jest.fn(),
    hostFunctions: { getTool: jest.fn() },
    rapidEnumeration: {},
    ...overrides,
  };
}

describe('the calls a resumed run replays', () => {
  it('are listed with their positions and times when the record has every time', () => {
    expect(new RunReplay(timed).hooks.replayedCalls).toEqual(replayedCalls);
    expect(new RunReplay({ journal: [entry(1, 'orders.list', 10), entry(2, 'mail.send')] }).hooks).not.toHaveProperty(
      'replayedCalls',
    );
  });

  it('let a run pause without the detector guard where the runtime takes them, counting only host function calls', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const judged = new RunReplay();
    const guarded = new RunReplay();
    judged.appliedByRuntime(true, true);
    guarded.appliedByRuntime(true, false);
    for (const replay of [judged, guarded]) {
      for (let index = 0; index < 40; index++) replay.answerOf({ callIndex: index }, 'orders.get', {});
      now.mockReturnValue(start + 6000);
      replay.decisionOf(40, 'orders.void', {});
    }

    expect(judged.replaysWithinDetectors(40)).toBe(true);
    expect(guarded.replaysWithinDetectors(40)).toBe(false);
    for (let index = 0; index < 100; index++) judged.hostFunctionCalled();
    judged.decisionOf(41, 'orders.void', {});
    expect(judged.replaysWithinDetectors(41)).toBe(false);
    jest.restoreAllMocks();
  });

  it('mark a pause that only a runtime judging them by their times can replay', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const judged = new RunReplay();
    const guarded = new RunReplay();
    judged.appliedByRuntime(true, true);
    guarded.appliedByRuntime(true, false);
    for (const replay of [judged, guarded]) replay.answerOf({ callIndex: 0 }, 'orders.list', {});
    expect(judged.needsCallTimes(0)).toBe(false);

    now.mockReturnValue(start + 6000);
    for (const replay of [judged, guarded]) replay.decisionOf(1, 'mail.send', {});

    expect(judged.needsCallTimes(1)).toBe(true);
    expect(guarded.needsCallTimes(1)).toBe(false);
    jest.restoreAllMocks();
  });

  it('keep the detector guard on a resume whose record lacks a time', () => {
    const replay = new RunReplay({ journal: [entry(1, 'orders.list')] });
    replay.appliedByRuntime(true, true);
    for (let index = 0; index < 31; index++) replay.answerOf({ callIndex: index }, 'orders.list', {});

    expect(replay.replaysWithinDetectors(30)).toBe(false);
  });
});

describe('the interpreter runtime', () => {
  function runnerEntry(capabilities: readonly string[]) {
    const runs: unknown[] = [];
    class FakeRunner {
      static readonly capabilities = capabilities;
      async run(_code: string, _handler: unknown, options: unknown) {
        runs.push(options);
        return { success: true, value: 1, stats: { duration: 0, toolCallCount: 0, iterationCount: 0 } };
      }
      dispose(): void {}
    }
    return { entry: { [AGENT_SCRIPT_RUNNER_EXPORT]: FakeRunner }, runs };
  }
  const base = ['validated-agentscript', 'host-functions', 'rapid-enumeration', 'replay'];
  const withReplay = new RunReplay(timed).hooks;

  it("passes the replayed calls to a runner with 'replayed-calls'", async () => {
    const { entry: loaded, runs } = runnerEntry([...base, 'replayed-calls']);
    const runner = await createInterpreterRuntime(async () => loaded).createRunner(spec(withReplay));
    await runner.run('return 1;');

    expect(runner.replaysCallTimes).toBe(true);
    expect(runs).toEqual([expect.objectContaining({ replayedCalls })]);
  });

  it('passes none to a runner without it, which then keeps the guard', async () => {
    const { entry: loaded, runs } = runnerEntry(base);
    const runner = await createInterpreterRuntime(async () => loaded).createRunner(spec(withReplay));
    await runner.run('return 1;');

    expect(runner.replaysCallTimes).toBe(false);
    expect(runs).toEqual([expect.not.objectContaining({ replayedCalls })]);
  });
});

describe('the node-vm runtime', () => {
  it('takes the option from Enclave 2.21.1, prereleases included', () => {
    expect(['2.21.0', '2.20.9', 'x'].map(supportsReplayedCalls)).toEqual([false, false, false]);
    expect(['2.21.1-rc.0', '2.21.1', '2.22.0', '3.0.0'].map(supportsReplayedCalls)).toEqual([true, true, true, true]);
  });

  it.each([
    ['2.21.1', true],
    ['2.21.0', false],
  ])('on Enclave %s, passes the replayed calls: %s', async (version, passed) => {
    const run = jest.fn().mockResolvedValue({ success: true, value: 1, stats: {} });
    class Enclave {
      run = run;
      dispose(): void {}
    }
    const runtime = createNodeVmRuntime(
      async () => ({ Enclave, REVIEW_ERROR_CODES: {} }) as never,
      async () => version,
    );
    const runner = await runtime.createRunner(spec(new RunReplay(timed).hooks));
    await runner.run('return 1;');

    expect(runner.replaysCallTimes).toBe(passed);
    expect(run.mock.calls[0][2]).toEqual(
      passed ? expect.objectContaining({ replayedCalls }) : { reviewContext: undefined },
    );
  });
});

describe('EnclaveService.replaysCallTimes', () => {
  function serviceWith(replaysCallTimes?: () => Promise<boolean>): EnclaveService {
    const runtime = {
      name: 'node-vm' as const,
      createRunner: jest.fn(),
      ...(replaysCallTimes && { replaysCallTimes }),
    };
    return new EnclaveService(new CodeCallConfig({ vm: { preset: 'secure', runtime: 'node-vm' } }), undefined, {
      'node-vm': runtime,
      interpreter: runtime as never,
    });
  }

  it('answers what the configured runtime says, and false for one that cannot tell or fails', async () => {
    expect(await serviceWith(async () => true).replaysCallTimes()).toBe(true);
    expect(await serviceWith(async () => false).replaysCallTimes()).toBe(false);
    expect(await serviceWith().replaysCallTimes()).toBe(false);
    expect(await serviceWith(() => Promise.reject(new Error('x'))).replaysCallTimes()).toBe(false);
  });
});
