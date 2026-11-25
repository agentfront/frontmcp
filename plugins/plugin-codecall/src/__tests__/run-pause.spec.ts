import type { PreReviewInput, ReviewDecision } from '@enclave-vm/core/worker';

import { argumentsHashOf, RunJournal } from '../runs/run-journal';
import { pausableSoFar, pendingCallOf, resumeSourceOf } from '../runs/run-pause';
import { journaledReviewHooks, RunReplay, type RunReplaySource } from '../runs/run-replay';

const APPROVAL: ReviewDecision = { decision: 'needs_approval', reason: 'destructive' };
const DENIAL: ReviewDecision = { decision: 'denied', reason: 'not now' };

function journalWithReplay(source?: RunReplaySource): RunJournal {
  const replay = new RunReplay(source);
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

  it('does not pause when two calls asked for approval, as in a parallel()', () => {
    const journal = journalWithReplay();
    journal.refuse('orders.void', { id: 1 }, 0, APPROVAL);
    journal.refuse('orders.void', { id: 2 }, 1, APPROVAL);

    expect(pendingCallOf('needs_approval', journal)).toBeUndefined();
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
