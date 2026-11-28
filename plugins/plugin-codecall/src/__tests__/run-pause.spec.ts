import type { PreReviewInput, ReviewDecision } from '@enclave-vm/core/worker';

import { createToolCallError, TOOL_CALL_ERROR_CODES, type ToolCallErrorCode } from '../errors';
import { markRefusedBeforeTool } from '../runs/call-stage';
import { argumentsHashOf, RunJournal } from '../runs/run-journal';
import { pausableSoFar, pausedRunOf, pendingCallOf, resumeSourceOf, retrySourceOf } from '../runs/run-pause';
import type { CodeCallRunInput } from '../runs/run-record.store';
import type { CodeCallCallDecision, CodeCallJournalEntry } from '../runs/run-record.types';
import { journaledReviewHooks, RunReplay, type RunReplaySource, type RunReplayToolLimits } from '../runs/run-replay';

const APPROVAL: CodeCallCallDecision = { decision: 'needs_approval', reason: 'destructive' };
const DENIAL: CodeCallCallDecision = { decision: 'denied', reason: 'not now' };
const LIMITS = { waitSeconds: 60, lifetimeSeconds: 60 };

function journalWithReplay(source?: RunReplaySource, toolLimits?: RunReplayToolLimits): RunJournal {
  const replay = new RunReplay(source, toolLimits);
  replay.appliedByRuntime(true);
  return new RunJournal({ keepResults: true, replay });
}

function callInput(callIndex: number, toolName: string, args: unknown = {}): PreReviewInput {
  return { phase: 'call', toolName, args, callIndex } as PreReviewInput;
}

describe('pendingCallOf', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('pauses at the one refusal that stopped the run, after a refusal the script caught', () => {
    const journal = journalWithReplay();
    journal.begin('orders.get', {}, 0).succeed({ id: 'o1' });
    journal.refuse('orders.note', {}, 1, DENIAL);
    journal.refuse('orders.void', {}, 2, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toMatchObject({ position: 3, tool: 'orders.void' });
  });

  it('pauses at the first of two calls that asked for approval, as in a parallel(), and asks for the other again', () => {
    const journal = journalWithReplay();
    journal.refuse('orders.void', { id: 1 }, 0, APPROVAL);
    journal.refuse('orders.void', { id: 2 }, 1, APPROVAL);

    const pending = pendingCallOf('needs_approval', journal);

    expect(pending).toMatchObject({ position: 1, tool: 'orders.void' });
    expect(resumeSourceOf(journal, pending as CodeCallJournalEntry).journal).toEqual([]);
  });

  it('does not pause when replaying the calls before it could trip the rate limit, compressed into a second', () => {
    const journal = journalWithReplay();
    for (let index = 0; index < 100; index++) {
      journal.replay?.answerOf({ callIndex: index }, 'orders.get', { index });
      journal.begin('orders.get', { index }, index).succeed({});
    }
    journal.replay?.decisionOf(100, 'orders.void', {});
    journal.refuse('orders.void', {}, 100, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toBeUndefined();
  });

  it('does not pause when the calls before it took longer than the shortest detector window', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const journal = journalWithReplay();
    journal.replay?.decisionOf(0, 'orders.list', {});
    journal.begin('orders.list', {}, 0).succeed([]);
    now.mockReturnValue(start + 6000);
    journal.replay?.decisionOf(1, 'mail.send', {});
    journal.refuse('mail.send', {}, 1, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toBeUndefined();
    expect(pausableSoFar(journal)).toBe(false);
  });
});

describe('the per-tool limit of a paused run', () => {
  function journalOfCalls(count: number, toolLimits?: RunReplayToolLimits): RunJournal {
    const journal = journalWithReplay(undefined, toolLimits);
    for (let index = 0; index < count; index++) {
      journal.replay?.answerOf({ callIndex: index }, 'orders.get', { index });
      journal.begin('orders.get', { index }, index).succeed({});
    }
    journal.replay?.decisionOf(count, 'orders.void', {});
    journal.refuse('orders.void', {}, count, APPROVAL);
    return journal;
  }

  it('does not pause after more calls to one tool than Enclave allows in its window, unless an override allows them', () => {
    expect(pendingCallOf('needs_approval', journalOfCalls(30))).toMatchObject({ position: 31 });
    expect(pendingCallOf('needs_approval', journalOfCalls(31))).toBeUndefined();
    expect(
      pendingCallOf('needs_approval', journalOfCalls(31, { threshold: 30, overrides: { 'orders.get': 40 } })),
    ).toMatchObject({ position: 32 });
  });
});

describe('retrySourceOf', () => {
  it('replays the attempt up to the approved call when it can pause there', () => {
    const journal = journalWithReplay();
    journal.begin('orders.get', {}, 0).succeed({ id: 'o1' });
    journal.refuse('orders.void', {}, 1, APPROVAL);

    expect(retrySourceOf('needs_approval', journal)?.source?.journal).toEqual([
      expect.objectContaining({ position: 1, result: { id: 'o1' } }),
    ]);
  });

  it('answers a call after the approved one that completed, as in a parallel(), from the record on retry', () => {
    const journal = journalWithReplay();
    journal.refuse('orders.void', {}, 0, APPROVAL);
    journal.begin('mail.send', {}, 1).succeed({ sent: true });

    expect(retrySourceOf('needs_approval', journal)?.source).toMatchObject({
      journal: [expect.objectContaining({ position: 2, result: { sent: true } })],
      pending: { call: { position: 1, tool: 'orders.void' } },
    });
  });

  it('does not run again an attempt with a call still running beside the approved one, which a retry would repeat', () => {
    const journal = journalWithReplay();
    journal.refuse('orders.void', {}, 0, APPROVAL);
    journal.begin('mail.send', {}, 1);

    expect(retrySourceOf('needs_approval', journal)).toBeUndefined();
  });

  it('runs the previous source again when the attempt cannot pause and no call reached its tool live', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const previous: RunReplaySource = {
      journal: [
        {
          position: 1,
          tool: 'orders.get',
          argumentsHash: argumentsHashOf({}),
          outcome: 'success',
          durationMs: 1,
          result: { id: 'o1' },
        },
      ],
    };
    const journal = journalWithReplay(previous);
    void journal.replay?.answerOf({ callIndex: 0 }, 'orders.get', {});
    journal.begin('orders.get', {}, 0).succeed({ id: 'o1' });
    now.mockReturnValue(start + 6000);
    journal.replay?.decisionOf(1, 'orders.void', {});
    journal.refuse('orders.void', {}, 1, APPROVAL);

    expect(retrySourceOf('needs_approval', journal, previous)).toEqual({ source: previous });
    jest.restoreAllMocks();
  });

  it('answers a call after the approved one whose result was refused once its tool ran, and asks again one refused before', () => {
    const attemptWith = (code: ToolCallErrorCode) => {
      const journal = journalWithReplay();
      journal.refuse('orders.void', {}, 0, APPROVAL);
      journal.begin('orders.export', {}, 1).fail(createToolCallError(code, 'orders.export'));
      return retrySourceOf('needs_approval', journal)?.source?.journal;
    };

    expect(attemptWith(TOOL_CALL_ERROR_CODES.RESULT_TOO_LARGE)).toEqual([
      expect.objectContaining({
        position: 2,
        phase: 'result',
        error: expect.objectContaining({ code: 'RESULT_TOO_LARGE' }),
      }),
    ]);
    expect(attemptWith(TOOL_CALL_ERROR_CODES.RATE_LIMITED)).toEqual([]);
  });
});

describe('the detector window of a paused run', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts at the run first operation, not when the runtime started', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const journal = journalWithReplay();
    now.mockReturnValue(start + 6000);
    journal.replay?.decisionOf(0, 'orders.get', {});
    journal.begin('orders.get', {}, 0).succeed({});
    now.mockReturnValue(start + 6100);
    journal.replay?.decisionOf(1, 'orders.void', {});
    journal.refuse('orders.void', {}, 1, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toMatchObject({ position: 2 });
  });
});

describe('arrival times', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps when each call reached the host after the run started, and continues the timeline on resume', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const first = journalWithReplay();
    now.mockReturnValue(start + 40);
    first.replay?.decisionOf(0, 'orders.get', {});
    first.begin('orders.get', {}, 0).succeed({ id: 'o1' });
    now.mockReturnValue(start + 90);
    first.replay?.decisionOf(1, 'orders.void', {});
    first.refuse('orders.void', {}, 1, APPROVAL);
    const source = resumeSourceOf(first, first.entriesSoFar()[1]);
    expect(source.journal[0].arrivedAtMs).toBe(40);
    expect(source.pending.call.arrivedAtMs).toBe(90);

    now.mockReturnValue(start + 60_000);
    const resumed = journalWithReplay(source);
    resumed.replay?.decisionOf(0, 'orders.get', {});
    now.mockReturnValue(start + 60_010);
    resumed.replay?.decisionOf(1, 'orders.void', {});
    now.mockReturnValue(start + 60_030);
    resumed.replay?.decisionOf(2, 'orders.note', {});

    expect([0, 1, 2].map((callIndex) => resumed.replay?.arrivalOf(callIndex))).toEqual([40, 90, 110]);
  });
});

describe('replaying refusals', () => {
  const source: RunReplaySource = {
    journal: [
      {
        position: 1,
        tool: 'orders.note',
        argumentsHash: argumentsHashOf({}),
        outcome: 'failure',
        phase: 'review',
        durationMs: 0,
        decision: DENIAL,
      },
      {
        position: 2,
        tool: 'orders.void',
        argumentsHash: argumentsHashOf({}),
        outcome: 'failure',
        phase: 'review',
        durationMs: 0,
        decision: APPROVAL,
      },
    ],
  };

  it('answers a refusal the script caught from the record, without asking the hooks, and journals it again', async () => {
    const journal = journalWithReplay(source);
    const pre = jest.fn(async () => ({ decision: 'allow' }) as ReviewDecision);
    const hooks = journaledReviewHooks({ pre }, journal);

    expect(await hooks.pre?.(callInput(0, 'orders.note'))).toEqual(DENIAL);
    expect(pre).not.toHaveBeenCalled();
    expect(journal.entriesSoFar()).toEqual([
      expect.objectContaining({ position: 1, phase: 'review', decision: DENIAL }),
    ]);
  });

  it('never answers a needs_approval from the record: its call ends the run', async () => {
    const journal = journalWithReplay(source);
    const hooks = journaledReviewHooks({ pre: async () => APPROVAL }, journal);

    expect(await hooks.pre?.(callInput(1, 'orders.void'))).toEqual({ decision: 'allow' });
    await expect(journal.replay?.answerOf({ callIndex: 1 }, 'orders.void', {})).rejects.toThrow(
      'call 2 to "orders.void" has no recorded result',
    );
  });
});

describe('resumeSourceOf', () => {
  it('keeps the corrected arguments of the same paused call, and sets each kind of read', () => {
    const journal = journalWithReplay();
    journal.begin('orders.get', {}, 0).succeed({ id: 'o1' });
    journal.refuse('orders.void', { id: 'o1' }, 1, APPROVAL);
    const pending = journal.entriesSoFar()[1];
    const previous: RunReplaySource = {
      journal: [],
      pending: { call: { position: 2, tool: 'orders.void', argumentsHash: 'x' }, arguments: { id: 'o2' } },
    };

    expect(resumeSourceOf(journal, pending, previous)).toEqual({
      journal: [expect.objectContaining({ position: 1, result: { id: 'o1' } })],
      clock: undefined,
      random: undefined,
      pending: { call: expect.objectContaining({ position: 2 }), arguments: { id: 'o2' } },
    });
    expect(resumeSourceOf(journal, pending).pending).not.toHaveProperty('arguments');
  });
});

describe('pausedRunOf', () => {
  it('keeps the corrected arguments a resume sent when the run pauses at that same call again', () => {
    const journal = journalWithReplay();
    journal.refuse('orders.void', { id: 'o1' }, 0, APPROVAL);
    const previous: RunReplaySource = {
      journal: [],
      pending: { call: { position: 1, tool: 'orders.void', argumentsHash: 'x' }, arguments: { id: 'o2' } },
    };
    const startedAt = new Date().toISOString();
    const run = { scriptHash: 'x', status: 'needs_approval', startedAt, endedAt: startedAt, journal: [] };
    const pauseOf = (source?: RunReplaySource) =>
      pausedRunOf(run as unknown as CodeCallRunInput, 'needs_approval', journal, { script: 'x' }, LIMITS, source)?.run
        .pause;

    expect(pauseOf(previous)).toMatchObject({ call: { position: 1 }, arguments: { id: 'o2' } });
    expect(pauseOf()).not.toHaveProperty('arguments');
  });
});

describe('pausing inside a parallel()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Five calls that reached the host at once, as a parallel()'s do; the one at `stopAt` is refused with `decision`. */
  function parallelOfFive(stopAt: number, decision: CodeCallCallDecision = APPROVAL): RunJournal {
    const journal = journalWithReplay();
    for (let index = 0; index < 5; index++) journal.replay?.decisionOf(index, 'orders.note', { index });
    for (let index = 0; index < 5; index++) {
      if (index === stopAt) journal.refuse('orders.note', { index }, index, decision);
      else journal.begin('orders.note', { index }, index).succeed({ noted: index });
    }
    return journal;
  }

  it('pauses at the call that needs approval with the calls after it recorded, which a resume answers from the record', () => {
    const journal = parallelOfFive(2);

    const pending = pendingCallOf('needs_approval', journal) as CodeCallJournalEntry;
    const source = resumeSourceOf(journal, pending);

    expect(pending).toMatchObject({ position: 3 });
    expect(source.journal.map((entry) => [entry.position, entry.result])).toEqual([
      [1, { noted: 0 }],
      [2, { noted: 1 }],
      [4, { noted: 3 }],
      [5, { noted: 4 }],
    ]);
    const resumed = new RunReplay(source);
    expect(resumed.answerOf({ callIndex: 2 }, 'orders.note', { index: 2 })).toBeUndefined();
    void expect(resumed.answerOf({ callIndex: 3 }, 'orders.note', { index: 3 })).resolves.toEqual({ noted: 3 });
  });

  it('does not pause while a call beside it is still running: it may have run, and nothing records what it did', () => {
    const journal = journalWithReplay();
    journal.begin('orders.note', { index: 0 }, 0).succeed({});
    journal.refuse('orders.void', {}, 1, APPROVAL);
    journal.begin('orders.export', {}, 2);

    expect(pendingCallOf('needs_approval', journal)).toBeUndefined();
    expect(pausableSoFar(journal)).toBe(true);
  });

  it('asks again the calls after the paused one that did not run, and a moot one before it', () => {
    const journal = journalWithReplay();
    journal.begin('orders.refund', {}, 0).fail(createToolCallError(TOOL_CALL_ERROR_CODES.VALIDATION, 'orders.refund'));
    journal.markMoot(1);
    journal.refuse('orders.void', {}, 1, APPROVAL);
    journal.refuse('orders.note', {}, 2, DENIAL);
    journal.begin('orders.note', { index: 3 }, 3).succeed({ noted: 3 });

    const pending = pendingCallOf('needs_approval', journal) as CodeCallJournalEntry;

    expect(pending).toMatchObject({ position: 2 });
    expect(resumeSourceOf(journal, pending).journal.map((entry) => entry.position)).toEqual([4]);
  });

  it('pauses at an uncaught refusal the script got last, not at one it caught and went on from', () => {
    const journal = journalWithReplay();
    journal.replay?.decisionOf(0, 'orders.note', {});
    journal.refuse('orders.note', {}, 0, DENIAL);
    journal.replay?.decisionOf(1, 'orders.get', {});
    journal.begin('orders.get', {}, 1).succeed({ id: 'o1' });
    for (const index of [2, 3]) journal.replay?.decisionOf(index, 'orders.void', { index });
    journal.refuse('orders.void', { index: 2 }, 2, DENIAL);
    journal.refuse('orders.void', { index: 3 }, 3, DENIAL);

    expect(pendingCallOf('denied', journal)).toMatchObject({ position: 3 });
  });

  it('does not pause at a refusal after which the script made another call: it caught it', () => {
    const journal = journalWithReplay();
    journal.replay?.decisionOf(0, 'orders.void', {});
    journal.refuse('orders.void', {}, 0, DENIAL);
    journal.replay?.decisionOf(1, 'orders.get', {});
    journal.begin('orders.get', {}, 1).succeed({});

    expect(pendingCallOf('denied', journal)).toBeUndefined();
  });

  it('pauses at the first call refused before its tool whose failure the script ended with, and asks the next again', () => {
    const journal = journalWithReplay();
    const { replay } = journal;
    const refused = (index: number) => {
      const error = markRefusedBeforeTool(createToolCallError(TOOL_CALL_ERROR_CODES.VALIDATION, 'orders.refund'));
      replay?.failedLive(index, error);
      return error;
    };
    for (let index = 0; index < 4; index++) replay?.answerOf({ callIndex: index }, 'orders.refund', { index });
    journal.begin('orders.refund', { index: 0 }, 0).succeed({ refunded: 1 });
    journal.begin('orders.refund', { index: 1 }, 1).fail(refused(1));
    journal.begin('orders.refund', { index: 2 }, 2).fail(refused(2));
    journal.begin('orders.refund', { index: 3 }, 3).succeed({ refunded: 4 });
    replay?.released(1);
    replay?.released(2);

    expect(pendingCallOf('runtime_error', journal)).toBeUndefined();
    replay?.endedWith([1, 2]);
    const pending = pendingCallOf('runtime_error', journal) as CodeCallJournalEntry;

    expect(pending).toMatchObject({ position: 2 });
    expect(pendingCallOf('ok', journal)).toBeUndefined();
    expect(resumeSourceOf(journal, pending).journal.map((entry) => entry.position)).toEqual([1, 4]);
  });

  it('judges a record with calls after the paused one by its whole run, not by recorded times', () => {
    const start = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const replay = new RunReplay();
    replay.appliedByRuntime(true, true);
    const journal = new RunJournal({ keepResults: true, replay });
    replay.decisionOf(0, 'orders.get', {});
    journal.begin('orders.get', {}, 0).succeed({});
    now.mockReturnValue(start + 6000);
    replay.decisionOf(1, 'orders.void', {});
    journal.refuse('orders.void', {}, 1, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toMatchObject({ position: 2 });

    replay.decisionOf(2, 'orders.note', {});
    journal.begin('orders.note', {}, 2).succeed({});

    expect(pendingCallOf('needs_approval', journal)).toBeUndefined();
  });

  it('keeps what the script read up to the last call a resume answers from the record', () => {
    jest.spyOn(Date, 'now').mockReturnValue(5000);
    const journal = journalWithReplay();
    const { replay } = journal;
    replay?.clock();
    replay?.decisionOf(0, 'orders.void', {});
    replay?.clock();
    replay?.decisionOf(1, 'orders.note', {});
    replay?.clock();
    journal.refuse('orders.void', {}, 0, APPROVAL);
    journal.begin('orders.note', {}, 1).succeed({});

    const pending = pendingCallOf('needs_approval', journal) as CodeCallJournalEntry;

    expect(resumeSourceOf(journal, pending).clock).toEqual([5000, 5000]);
  });
});

describe('holding a refusal in a run that can pause', () => {
  it('journals a needs_approval once the call running beside it settled, and a refusal the run never gave not at all', async () => {
    const journal = journalWithReplay();
    const hooks = journaledReviewHooks(
      { pre: async (input) => (input.phase === 'call' && input.callIndex === 2 ? DENIAL : APPROVAL) },
      journal,
    );
    const running = journal.begin('orders.export', {}, 0);
    const order: string[] = [];

    const answer = async (callIndex: number, tool: string) => {
      const decision = await hooks.pre?.(callInput(callIndex, tool));
      order.push(`${callIndex}:${decision?.decision}`);
    };
    const approval = answer(1, 'orders.void');
    const denial = answer(2, 'orders.note');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);

    running.succeed({ exported: true });
    await Promise.all([approval, denial]);

    expect(order).toEqual(['1:needs_approval', '2:denied']);
    expect(journal.entriesSoFar().map((entry) => [entry.position, entry.decision?.decision])).toEqual([
      [1, undefined],
      [2, 'needs_approval'],
    ]);
    expect(pendingCallOf('needs_approval', journal)).toMatchObject({ position: 2 });
  });

  it('answers at once in a run that cannot pause', async () => {
    const journal = new RunJournal();
    const hooks = journaledReviewHooks({ pre: async () => APPROVAL }, journal);
    journal.begin('orders.export', {}, 0);

    await expect(hooks.pre?.(callInput(1, 'orders.void'))).resolves.toEqual(APPROVAL);
    expect(journal.entriesSoFar()).toHaveLength(2);
  });
});
