/** Budget counts per caller in fixed windows of shared storage, checked before each call and added to after it. */
import type { PreReviewInput, ReviewDecision } from '@enclave-vm/core/worker';

import { InvalidInputError, ToolExecutionError } from '@frontmcp/sdk';
import { createRootStorage, MemoryStorageAdapter, type NamespacedStorage } from '@frontmcp/utils';

import {
  BUDGET_EXCEEDED_RULE,
  BUDGET_UNAVAILABLE_RULE,
  budgetCallerOf,
  BudgetMeter,
  withBudgets,
} from '../budgets/budget-meter';
import { CodeCallBudgetStore } from '../budgets/budget-store';
import { codeCallBudgetsOptionsSchema, type CodeCallBudget } from '../codecall.types';

const HOUR = 3600;
const RECORDS_PER_HOUR: CodeCallBudget = {
  name: 'records-per-hour',
  counts: 'recordsChanged',
  limit: 200,
  windowSeconds: HOUR,
  onExceeded: 'needs_approval',
};
const CALLS_PER_MINUTE: CodeCallBudget = {
  name: 'calls-per-minute',
  counts: 'toolCalls',
  limit: 2,
  windowSeconds: 60,
  onExceeded: 'denied',
};

async function sharedStorage(): Promise<NamespacedStorage> {
  const adapter = new MemoryStorageAdapter();
  await adapter.connect();
  return createRootStorage(adapter).namespace('codecall-budgets');
}

function callerContext(subject: string | undefined, session?: string) {
  return {
    auth: { isAnonymous: subject === undefined, user: { sub: subject ?? '' } },
    tryGetContext: () => (session ? { verifiedSessionId: session } : undefined),
  };
}

async function useCalls(meter: BudgetMeter, records: number, calls = 1): Promise<void> {
  for (let index = 0; index < calls; index++) {
    const call = meter.startCall();
    call.onRecordsChanged(records);
    await call.end();
  }
}

const callInput = (toolName: string): PreReviewInput =>
  ({ phase: 'call', toolName, args: {}, callIndex: 0, analysis: {} }) as unknown as PreReviewInput;

describe('budgets options', () => {
  it('answers needs_approval by default and keeps counts in their own namespace', () => {
    const parsed = codeCallBudgetsOptionsSchema.parse({
      limits: [{ name: 'records-per-hour', counts: 'recordsChanged', limit: 200, windowSeconds: HOUR }],
    });

    expect(parsed.limits[0].onExceeded).toBe('needs_approval');
    expect(parsed.namespace).toBe('codecall-budgets');
    expect(parsed.storage).toEqual({ type: 'auto' });
  });

  it.each([
    ['a repeated name', [RECORDS_PER_HOUR, RECORDS_PER_HOUR]],
    ['a name with a colon', [{ ...RECORDS_PER_HOUR, name: 'records:hour' }]],
    ['a limit of 0', [{ ...RECORDS_PER_HOUR, limit: 0 }]],
    ['a fractional window', [{ ...RECORDS_PER_HOUR, windowSeconds: 1.5 }]],
    ['another count', [{ ...RECORDS_PER_HOUR, counts: 'cost' }]],
    ['no budget', []],
  ])('refuses %s', (_, limits) => {
    expect(codeCallBudgetsOptionsSchema.safeParse({ limits }).success).toBe(false);
  });
});

describe('budgetCallerOf', () => {
  it('counts a signed-in user or an API key by its subject, whatever the session', () => {
    expect(budgetCallerOf(callerContext('user-1', 's1'))).toBe(budgetCallerOf(callerContext('user-1', 's2')));
    expect(budgetCallerOf(callerContext('static:3f2a9c'))).toBe('subject:static:3f2a9c');
  });

  it('counts an anonymous caller by its verified session, and all anonymous callers without one together', () => {
    expect(budgetCallerOf(callerContext(undefined, 's1'))).toBe('session:s1');
    expect(budgetCallerOf(callerContext(undefined))).toBe('anonymous');
  });
});

describe('budget counts', () => {
  let now: number;
  let storage: NamespacedStorage;
  const clock = () => now;

  beforeEach(async () => {
    now = Date.UTC(2026, 10, 25, 10, 0, 0);
    storage = await sharedStorage();
  });

  it('stops the call after the one that crossed a recordsChanged limit, for that caller only', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = new BudgetMeter(store, 'subject:ada');

    await useCalls(ada, 150);
    expect(await ada.check('users.archive')).toEqual({ decision: 'allow' });
    await useCalls(ada, 80);

    const decision = await ada.check('users.archive');
    expect(decision).toMatchObject({ decision: 'needs_approval', reason: expect.stringContaining('records-per-hour') });
    expect(decision.findings).toEqual([
      expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE, toolName: 'users.archive' }),
    ]);
    expect(await new BudgetMeter(store, 'subject:bob').check('users.archive')).toEqual({ decision: 'allow' });
  });

  it('holds the counts across two instances sharing one storage adapter', async () => {
    const first = new BudgetMeter(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');
    const second = new BudgetMeter(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');

    await useCalls(first, 0);
    await useCalls(second, 0);

    expect(await first.check('users.get')).toMatchObject({ decision: 'denied' });
    expect(await second.check('users.get')).toMatchObject({ decision: 'denied' });
  });

  it('starts again in the next window, and keeps a count for at least its window', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = new BudgetMeter(store, 'subject:ada');
    await useCalls(ada, 0, 2);
    now += 30_000;

    expect(await ada.check('users.get')).toMatchObject({
      decision: 'denied',
      findings: [expect.objectContaining({ suggestion: 'The budget resets in 30 seconds' })],
    });
    const [key] = await storage.keys('*');
    expect(await storage.ttl(key)).toBeGreaterThan(55);

    now += 30_000;
    expect(await ada.check('users.get')).toEqual({ decision: 'allow' });
  });

  it('does not count a call the flow refused before its tool ran as a tool call', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = new BudgetMeter(store, 'subject:ada');

    await ada.startCall().end(new InvalidInputError('bad input'));
    await ada.startCall().end(new InvalidInputError('bad input'));
    expect(await ada.check('users.get')).toEqual({ decision: 'allow' });

    await ada.startCall().end(new ToolExecutionError('users.get', new Error('boom')));
    await ada.startCall().end();
    expect(await ada.check('users.get')).toMatchObject({ decision: 'denied' });
  });

  it('counts a call once, and no report after it ended', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = new BudgetMeter(store, 'subject:ada');
    const call = ada.startCall();
    call.onRecordsChanged(150);
    await call.end();
    await call.end(new Error('again'));
    call.onRecordsChanged(150);
    await ada.startCall().end();

    expect(await ada.check('users.archive')).toEqual({ decision: 'allow' });
  });

  it("never stops CodeCall's reserved names, such as keep and recall", async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = new BudgetMeter(store, 'subject:ada');
    await useCalls(ada, 0, 2);

    expect(await ada.check('codecall:recall')).toEqual({ decision: 'allow' });
    expect(await ada.check('codecall:keep')).toEqual({ decision: 'allow' });
  });

  it('treats a stored count that is not a number as reached', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = new BudgetMeter(store, 'subject:ada');
    await useCalls(ada, 0);
    const [key] = await storage.keys('*');
    await storage.set(key, 'not-a-count');

    expect(await ada.check('users.get')).toMatchObject({ decision: 'denied' });
  });

  it('denies the call when the counts cannot be read', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    jest.spyOn(storage, 'mget').mockRejectedValueOnce(new Error('connection refused'));

    const decision = await new BudgetMeter(store, 'subject:ada').check('users.archive');

    expect(decision).toMatchObject({ decision: 'denied', findings: [{ rule: BUDGET_UNAVAILABLE_RULE }] });
  });

  it('denies the rest of the run once a count could not be kept', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = new BudgetMeter(store, 'subject:ada');
    jest.spyOn(storage, 'incrBy').mockRejectedValueOnce(new Error('connection refused'));

    await useCalls(ada, 10);

    expect(await ada.check('users.archive')).toMatchObject({ decision: 'denied' });
  });
});

describe('withBudgets', () => {
  it('asks the budgets before the review at each call, and only the review for the script', async () => {
    const storage = await sharedStorage();
    const store = new CodeCallBudgetStore(storage, [{ ...CALLS_PER_MINUTE, limit: 1 }]);
    const ada = new BudgetMeter(store, 'subject:ada');
    const reviewPre = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'allow' }));
    const hooks = withBudgets({ pre: reviewPre, timeoutMs: 5000 }, ada);

    expect(hooks?.timeoutMs).toBe(5000);
    expect(await hooks?.pre?.(callInput('users.get'))).toEqual({ decision: 'allow' });
    await useCalls(ada, 0);
    expect(await hooks?.pre?.(callInput('users.get'))).toMatchObject({ decision: 'denied' });
    expect(reviewPre).toHaveBeenCalledTimes(1);
  });

  it('is the budgets alone without review, and the review alone without budgets', async () => {
    const review = { pre: async (): Promise<ReviewDecision> => ({ decision: 'allow' }) };
    const ada = new BudgetMeter(new CodeCallBudgetStore(await sharedStorage(), [CALLS_PER_MINUTE]), 'subject:ada');

    expect(await withBudgets(undefined, ada)?.pre?.(callInput('users.get'))).toEqual({ decision: 'allow' });
    expect(withBudgets(review, undefined)).toBe(review);
    expect(withBudgets(undefined, undefined)).toBeUndefined();
  });
});
