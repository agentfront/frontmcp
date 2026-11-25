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

  it('keeps output quiet until the script passes the calls of the run it replays', async () => {
    const write = jest.fn();
    const replay = new RunReplay(source);
    const quiet = replay.quiet(write);

    quiet?.('before');
    await replay.answerOf({ callIndex: 0 }, 'users.get', { id: 1 });
    await replay.answerOf({ callIndex: 1 }, 'users.update', { id: 1 })?.catch(() => undefined);
    quiet?.('between the last recorded call and the next');
    expect(replay.answerOf({ callIndex: 2 }, 'users.delete', {})).toBeUndefined();
    quiet?.('after');

    expect(write.mock.calls).toEqual([['after']]);
  });

  it('writes everything in a run that replays none', () => {
    const write = jest.fn();
    new RunReplay().quiet(write)?.('line');

    expect(write).toHaveBeenCalledWith('line');
  });
});
