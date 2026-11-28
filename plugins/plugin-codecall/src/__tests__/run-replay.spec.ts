import { argumentsHashOf } from '../runs/run-journal';
import type { CodeCallJournalEntry } from '../runs/run-record.types';
import { RunDivergedError, RunReplay, type RunReplaySource } from '../runs/run-replay';

function entry(
  position: number,
  tool: string,
  args: unknown,
  outcome: Partial<CodeCallJournalEntry>,
): CodeCallJournalEntry {
  return { position, tool, argumentsHash: argumentsHashOf(args), outcome: 'success', durationMs: 1, ...outcome };
}

const source: RunReplaySource = {
  journal: [
    entry(1, 'users.get', { id: 1 }, { result: { name: 'Ada' } }),
    entry(
      2,
      'users.update',
      { id: 1 },
      { outcome: 'failure', phase: 'execute', error: { code: 'EXECUTION', message: 'Locked' } },
    ),
  ],
  clock: [1000, 2000],
  random: [0.25],
};

describe('RunReplay', () => {
  it('returns the recorded clock and random values in order, then live ones, and records them all', () => {
    jest.spyOn(Date, 'now').mockReturnValue(9000);
    jest.spyOn(Math, 'random').mockReturnValue(0.75);
    const replay = new RunReplay(source);
    replay.appliedByRuntime(true);

    expect([replay.clock(), replay.clock(), replay.clock()]).toEqual([1000, 2000, 9000]);
    expect([replay.random(), replay.random()]).toEqual([0.25, 0.75]);
    expect(replay.recordedReads()).toEqual({ clock: [1000, 2000, 9000], random: [0.25, 0.75] });
    jest.restoreAllMocks();
  });

  it('records nothing when the runtime did not apply it', () => {
    const replay = new RunReplay();
    replay.clock();

    expect(replay.recordedReads()).toEqual({});
  });

  it('answers a recorded call with its result, or its error as the script got it', async () => {
    const replay = new RunReplay(source);

    await expect(replay.answerOf({ callIndex: 0 }, 'users.get', { id: 1 })).resolves.toEqual({ name: 'Ada' });
    await expect(replay.answerOf({ callIndex: 1 }, 'users.update', { id: 1 })).rejects.toEqual({
      code: 'EXECUTION',
      message: 'Locked',
      toolName: 'users.update',
    });
    expect(replay.answerOf({ callIndex: 2 }, 'users.delete', { id: 1 })).toBeUndefined();
  });

  it.each([
    ['another tool', 'users.delete', { id: 1 }, 'call 1 was to "users.get", not "users.delete"'],
    ['other arguments', 'users.get', { id: 2 }, 'call 1 to "users.get" had other arguments'],
  ])(
    'ends the run at a recorded position called with %s, and refuses every call after',
    async (_, tool, args, what) => {
      const replay = new RunReplay(source);

      await expect(replay.answerOf({ callIndex: 0 }, tool, args)).rejects.toThrow(
        new RunDivergedError(`The run diverged from its journal: ${what}`),
      );
      await expect(replay.answerOf({ callIndex: 2 }, 'users.delete', {})).rejects.toBeInstanceOf(RunDivergedError);
      expect(replay.divergenceOf(false)?.message).toContain(what);
    },
  );

  it('refuses to answer a call whose result was not recorded', async () => {
    const replay = new RunReplay({ journal: [entry(1, 'users.get', {}, { outcome: 'unfinished' })] });

    await expect(replay.answerOf({ callIndex: 0 }, 'users.get', {})).rejects.toBeInstanceOf(RunDivergedError);
  });

  it('is a divergence when the script ends before the recorded calls, unless the run timed out', async () => {
    const replay = new RunReplay(source);
    await replay.answerOf({ callIndex: 0 }, 'users.get', { id: 1 });

    expect(replay.divergenceOf(true)).toBeUndefined();
    expect(replay.divergenceOf(false)?.message).toBe(
      'The run diverged from its journal: script ended before call 2, which its run made',
    );
  });

  it('skips only as many lines of output as the run it replays wrote, whatever the calls reached', async () => {
    const write = jest.fn();
    const replay = new RunReplay({ ...source, outputs: 2 });
    const quiet = replay.quiet(write);

    quiet?.('first');
    await replay.answerOf({ callIndex: 0 }, 'users.get', { id: 1 });
    await replay.answerOf({ callIndex: 1 }, 'users.update', { id: 1 })?.catch(() => undefined);
    quiet?.('second');
    quiet?.('never written by the first run');

    expect(write.mock.calls).toEqual([['never written by the first run']]);
  });

  it('counts the lines it wrote for the next replay', () => {
    const replay = new RunReplay();
    replay.appliedByRuntime(true);
    const quiet = replay.quiet(jest.fn());
    quiet?.('one');
    quiet?.('two');

    expect(replay.recordedReads()).toEqual({ outputs: 2 });
  });

  it('writes everything in a run that replays none', () => {
    const write = jest.fn();
    new RunReplay().quiet(write)?.('line');

    expect(write).toHaveBeenCalledWith('line');
  });

  describe('resuming a paused run', () => {
    const paused: RunReplaySource = {
      journal: [
        entry(1, 'users.get', { id: 1 }, { result: { name: 'Ada' } }),
        entry(
          2,
          'users.delete',
          { id: 9 },
          {
            outcome: 'failure',
            phase: 'review',
            decision: { decision: 'needs_changes', findings: [{ rule: 'input-schema', message: 'id' }] },
          },
        ),
      ],
      clock: [1000],
      pending: {
        call: { position: 3, tool: 'users.delete', argumentsHash: argumentsHashOf({ id: 1 }) },
        arguments: { id: 2 },
      },
    };

    it("gives the call-phase hooks a recorded call's decision without asking them, and asks for the pending call", () => {
      const replay = new RunReplay(paused);

      expect(replay.decisionOf(0, 'users.get', { id: 1 })).toEqual({ decision: 'allow' });
      expect(replay.decisionOf(1, 'users.delete', { id: 9 })).toEqual(paused.journal[1].decision);
      expect(replay.decisionOf(2, 'users.delete', { id: 1 })).toBeUndefined();
      expect(replay.decisionOf(3, 'users.list', {})).toBeUndefined();
    });

    it('runs the pending call live with its corrected arguments, and every other call with its own', async () => {
      const replay = new RunReplay(paused);

      expect(replay.answerOf({ callIndex: 2 }, 'users.delete', { id: 1 })).toBeUndefined();
      expect(replay.argumentsFor(2, { id: 1 })).toEqual({ id: 2 });
      expect(replay.argumentsFor(3, { id: 1 })).toEqual({ id: 1 });
    });

    it('ends the run when the script makes another call where the run paused', async () => {
      const replay = new RunReplay(paused);

      expect(replay.decisionOf(2, 'users.delete', { id: 5 })).toEqual({ decision: 'allow' });
      await expect(replay.answerOf({ callIndex: 2 }, 'users.delete', { id: 5 })).rejects.toThrow(
        'The run diverged from its journal: call 3 to "users.delete" had other arguments',
      );
    });

    it('is a divergence when the script ends before the call it paused at', async () => {
      const replay = new RunReplay(paused);
      await replay.answerOf({ callIndex: 0 }, 'users.get', { id: 1 });
      replay.decisionOf(1, 'users.delete', { id: 9 });

      expect(replay.divergenceOf(false)?.message).toContain('script ended before call 3');
    });

    describe('inside a parallel()', () => {
      const parallel: RunReplaySource = {
        journal: [
          entry(1, 'orders.note', { id: 1 }, { result: { noted: 1 }, arrivedAtMs: 10 }),
          entry(4, 'orders.note', { id: 4 }, { result: { noted: 4 }, arrivedAtMs: 12 }),
        ],
        pending: {
          call: { position: 2, tool: 'orders.void', argumentsHash: argumentsHashOf({ id: 2 }), arrivedAtMs: 11 },
        },
      };

      it('answers the calls after the paused one from the record, and asks a call the record leaves out live', async () => {
        const replay = new RunReplay(parallel);

        expect(replay.answerOf({ callIndex: 1 }, 'orders.void', { id: 2 })).toBeUndefined();
        expect(replay.decisionOf(2, 'orders.void', { id: 3 })).toBeUndefined();
        expect(replay.answerOf({ callIndex: 2 }, 'orders.void', { id: 3 })).toBeUndefined();
        await expect(replay.answerOf({ callIndex: 3 }, 'orders.note', { id: 4 })).resolves.toEqual({ noted: 4 });
      });

      it('is a divergence when the script ends before the last recorded call, after the paused one', async () => {
        const replay = new RunReplay(parallel);
        await replay.answerOf({ callIndex: 0 }, 'orders.note', { id: 1 });
        replay.answerOf({ callIndex: 1 }, 'orders.void', { id: 2 });

        expect(replay.divergenceOf(false)?.message).toContain('script ended before call 4');
      });

      it("gives Enclave's detectors only the recorded calls before the paused one, the first that runs live", () => {
        const replay = new RunReplay(parallel);

        expect(replay.hooks).toMatchObject({
          replayedCalls: [{ callIndex: 0, toolName: 'orders.note', elapsedMs: 10 }],
          replayedCallsResumeAtMs: 11,
        });
      });
    });

    it('keeps the clock and random values read before a call reached the host', () => {
      jest.spyOn(Date, 'now').mockReturnValue(5000);
      const replay = new RunReplay();
      replay.appliedByRuntime(true);
      replay.clock();
      replay.decisionOf(0, 'users.get', {});
      replay.clock();

      expect(replay.readsBefore(0)).toEqual({ clock: [5000] });
      expect(replay.recordedReads()).toEqual({ clock: [5000, 5000] });
      jest.restoreAllMocks();
    });
  });
});
