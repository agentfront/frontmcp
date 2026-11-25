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
import { ReviewApprovals, type ApprovalRecordView } from '../review/review-approvals';

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

const ARCHIVE = { toolName: 'users.archive', args: { ids: ['t1'] } };

const GRANTED_AT = Date.now() - 600_000;

/** The approvals of one script, with the states a person gave approval ids in the Approval plugin, 10 minutes ago. */
function approvalsWith(states: Record<string, ApprovalRecordView['state']> = {}, grantedAt = GRANTED_AT) {
  const queryApprovals = async ({ toolId }: { toolId: string }): Promise<ApprovalRecordView[]> => {
    const state = states[toolId];
    return state ? [{ state, scope: 'session', grantedAt, metadata: { maxCalls: 10 } }] : [];
  };
  return new ReviewApprovals({
    scriptHash: 'script-hash',
    policyVersion: 'policy',
    maxAgeMs: 3_600_000,
    service: { queryApprovals },
    granted: new Set(),
  });
}

function meterFor(
  store: CodeCallBudgetStore,
  caller: string,
  { approvals = approvalsWith(), grantedByPerson = new Set<string>(), canApprove = true } = {},
): BudgetMeter {
  return new BudgetMeter(store, caller, { approvals, grantedByPerson, canApprove });
}

const recordsGrantOf = (call = ARCHIVE) => approvalsWith().budgetReferenceFor(call, 'records-per-hour').id;

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
    const ada = meterFor(store, 'subject:ada');

    await useCalls(ada, 150);
    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({ decision: 'allow' });
    await useCalls(ada, 80);

    const decision = await ada.check(ARCHIVE.toolName, ARCHIVE.args);
    expect(decision).toMatchObject({ decision: 'needs_approval', reason: expect.stringContaining('records-per-hour') });
    expect(decision.findings).toEqual([
      expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE, toolName: 'users.archive' }),
    ]);
    expect(await meterFor(store, 'subject:bob').check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({ decision: 'allow' });
  });

  it('holds the counts across two instances sharing one storage adapter', async () => {
    const first = meterFor(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');
    const second = meterFor(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');

    await useCalls(first, 0);
    await useCalls(second, 0);

    expect(await first.check('users.get', {})).toMatchObject({ decision: 'denied' });
    expect(await second.check('users.get', {})).toMatchObject({ decision: 'denied' });
  });

  it('starts again in the next window, and keeps a count for at least its window', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0, 2);
    now += 30_000;

    expect(await ada.check('users.get', {})).toMatchObject({
      decision: 'denied',
      findings: [expect.objectContaining({ message: expect.stringContaining('resets in 30 seconds') })],
    });
    const [key] = await storage.keys('*');
    expect(await storage.ttl(key)).toBeGreaterThan(55);

    now += 30_000;
    expect(await ada.check('users.get', {})).toEqual({ decision: 'allow' });
  });

  it('does not count a call the flow refused before its tool ran as a tool call', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');

    await ada.startCall().end(new InvalidInputError('bad input'));
    await ada.startCall().end(new InvalidInputError('bad input'));
    expect(await ada.check('users.get', {})).toEqual({ decision: 'allow' });

    await ada.startCall().end(new ToolExecutionError('users.get', new Error('boom')));
    await ada.startCall().end();
    expect(await ada.check('users.get', {})).toMatchObject({ decision: 'denied' });
  });

  it.each([[-1], [1.5], [Number.NaN]])(
    'refuses a report of %p records, so the call fails and no count drops',
    async (count) => {
      const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
      const ada = meterFor(store, 'subject:ada');
      await useCalls(ada, 200);
      const call = ada.startCall();

      expect(() => call.onRecordsChanged(count)).toThrow(RangeError);
      await call.end(new ToolExecutionError('users.archive', new RangeError('bad count')));
      expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({ decision: 'needs_approval' });
    },
  );

  it('counts a call once, and no report after it ended', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = meterFor(store, 'subject:ada');
    const call = ada.startCall();
    call.onRecordsChanged(150);
    await call.end();
    await call.end(new Error('again'));
    call.onRecordsChanged(150);
    await ada.startCall().end();

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({ decision: 'allow' });
  });

  it("never stops CodeCall's reserved names, such as keep and recall", async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0, 2);

    expect(await ada.check('codecall:recall', {})).toEqual({ decision: 'allow' });
    expect(await ada.check('codecall:keep', {})).toEqual({ decision: 'allow' });
  });

  it('treats a stored count that is not a number as reached', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0);
    const [key] = await storage.keys('*');
    await storage.set(key, 'not-a-count');

    expect(await ada.check('users.get', {})).toMatchObject({ decision: 'denied' });
  });

  it('denies the call when the counts cannot be read', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    jest.spyOn(storage, 'mget').mockRejectedValueOnce(new Error('connection refused'));

    const decision = await meterFor(store, 'subject:ada').check(ARCHIVE.toolName, ARCHIVE.args);

    expect(decision).toMatchObject({ decision: 'denied', findings: [{ rule: BUDGET_UNAVAILABLE_RULE }] });
  });

  it('denies the rest of the run once a count could not be kept', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = meterFor(store, 'subject:ada');
    jest.spyOn(storage, 'incrBy').mockRejectedValueOnce(new Error('connection refused'));

    await useCalls(ada, 10);

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({ decision: 'denied' });
  });
});

describe('budget approvals', () => {
  let store: CodeCallBudgetStore;

  beforeEach(async () => {
    store = new CodeCallBudgetStore(await sharedStorage(), [RECORDS_PER_HOUR]);
    await useCalls(meterFor(store, 'subject:ada'), 200);
  });

  it('asks for the call over the budget with a reference shaped as a review approval, for that call only', async () => {
    const approvals = approvalsWith();
    const ada = meterFor(store, 'subject:ada', { approvals });

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({ decision: 'needs_approval' });
    const reference = ada.pendingApproval?.reference;
    expect(reference).toEqual({
      id: expect.stringMatching(/^codecall:approval:[0-9a-f]{64}$/),
      toolName: ARCHIVE.toolName,
      argumentsHash: approvals.referenceFor(ARCHIVE).argumentsHash,
    });
    expect(ada.pendingApproval?.call).toEqual(ARCHIVE);
    expect(reference?.id).not.toBe(approvals.referenceFor(ARCHIVE).id);
    expect(reference?.id).not.toBe(
      approvals.budgetReferenceFor({ ...ARCHIVE, args: { ids: ['t2'] } }, 'records-per-hour').id,
    );
  });

  it("spends a person's grant on one call, and asks again for the same call after it", async () => {
    const grantedByPerson = new Set([recordsGrantOf()]);
    const ada = meterFor(store, 'subject:ada', { grantedByPerson });

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({ decision: 'allow' });
    expect(grantedByPerson.size).toBe(0);
    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({ decision: 'needs_approval' });
    expect(await ada.check(ARCHIVE.toolName, { ids: ['t2'] })).toMatchObject({ decision: 'needs_approval' });
  });

  it('spends an Approval plugin grant once, never again in a later run, and takes a new grant as new', async () => {
    const approvals = approvalsWith({ [recordsGrantOf()]: 'approved' });

    expect(await meterFor(store, 'subject:ada', { approvals }).check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({
      decision: 'allow',
    });
    expect(await meterFor(store, 'subject:ada', { approvals }).check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({
      decision: 'needs_approval',
    });
    const regranted = approvalsWith({ [recordsGrantOf()]: 'approved' }, GRANTED_AT + 1);
    expect(
      await meterFor(store, 'subject:ada', { approvals: regranted }).check(ARCHIVE.toolName, ARCHIVE.args),
    ).toEqual({ decision: 'allow' });
  });

  it('lets only one of two concurrent runs on instances sharing a store spend one grant', async () => {
    const storage = await sharedStorage();
    const first = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR]);
    const second = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR]);
    await useCalls(meterFor(first, 'subject:ada'), 200);
    const approvals = approvalsWith({ [recordsGrantOf()]: 'approved' });

    const decisions = await Promise.all(
      [first, second].map((instance) =>
        meterFor(instance, 'subject:ada', { approvals }).check(ARCHIVE.toolName, ARCHIVE.args),
      ),
    );

    expect(decisions.map(({ decision }) => decision).sort()).toEqual(['allow', 'needs_approval']);
  });

  it('marks a spent grant for no longer than the grant counts, and lets one of two claims win', async () => {
    const storage = await sharedStorage();
    const instance = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR]);

    const claims = await Promise.all([instance.claim('grant-1', 3000), instance.claim('grant-1', 3000)]);

    expect(claims.sort()).toEqual([false, true]);
    expect(await instance.isSpent('grant-1')).toBe(true);
    const [marker] = await storage.keys('grant.spent:*');
    expect(await storage.ttl(marker)).toBeLessThanOrEqual(3000);
    const [{ countsForSeconds }] = (await approvalsWith({ [recordsGrantOf()]: 'approved' }).recordedGrantsOf(
      approvalsWith().budgetReferenceFor(ARCHIVE, 'records-per-hour'),
    )) as Array<{ countsForSeconds: number }>;
    expect(countsForSeconds).toBeGreaterThan(2990);
    expect(countsForSeconds).toBeLessThanOrEqual(3000);
  });

  it('denies a call over the budget when nobody can approve it', async () => {
    const ada = meterFor(store, 'subject:ada', { canApprove: false });

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({
      decision: 'denied',
      reason: expect.stringContaining('nobody can approve it here'),
    });
    expect(ada.pendingApproval).toBeUndefined();
  });

  it('never lifts a budget with a destructive-call approval, nor approves a destructive call with a budget one', async () => {
    const reviewReference = approvalsWith().referenceFor(ARCHIVE);
    const budgetReference = approvalsWith().budgetReferenceFor(ARCHIVE, 'records-per-hour');
    const approvals = approvalsWith({
      [reviewReference.id]: 'approved',
      [reviewReference.anyArgumentsId as string]: 'approved',
    });

    expect(await meterFor(store, 'subject:ada', { approvals }).check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({
      decision: 'needs_approval',
    });
    expect(await approvalsWith({ [budgetReference.id]: 'approved' }).stateOf(reviewReference, false)).toBe('missing');
  });

  it('denies a call a person refused to approve over the budget', async () => {
    const ada = meterFor(store, 'subject:ada', { approvals: approvalsWith({ [recordsGrantOf()]: 'denied' }) });

    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({
      decision: 'denied',
      reason: expect.stringContaining('a person refused to approve it'),
    });
  });

  it('needs a grant for each budget the call is over, and spends none until it has all', async () => {
    const callsPerHour: CodeCallBudget = { ...CALLS_PER_MINUTE, name: 'calls-per-hour', onExceeded: 'needs_approval' };
    const both = new CodeCallBudgetStore(await sharedStorage(), [RECORDS_PER_HOUR, callsPerHour]);
    await useCalls(meterFor(both, 'subject:ada'), 200, 2);
    const recordsId = approvalsWith().budgetReferenceFor(ARCHIVE, 'records-per-hour').id;
    const callsId = approvalsWith().budgetReferenceFor(ARCHIVE, 'calls-per-hour').id;

    const grantedByPerson = new Set([recordsId]);
    const ada = meterFor(both, 'subject:ada', { grantedByPerson });
    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toMatchObject({
      decision: 'needs_approval',
      reason: expect.stringContaining('calls-per-hour'),
    });
    expect(ada.pendingApproval?.reference.id).toBe(callsId);
    expect(grantedByPerson.has(recordsId)).toBe(true);
    grantedByPerson.add(callsId);
    expect(await ada.check(ARCHIVE.toolName, ARCHIVE.args)).toEqual({ decision: 'allow' });
    expect(grantedByPerson.size).toBe(0);
  });
});

describe('withBudgets', () => {
  it('asks the budgets before the review at each call, and only the review for the script', async () => {
    const storage = await sharedStorage();
    const store = new CodeCallBudgetStore(storage, [{ ...CALLS_PER_MINUTE, limit: 1 }]);
    const ada = meterFor(store, 'subject:ada');
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
    const ada = meterFor(new CodeCallBudgetStore(await sharedStorage(), [CALLS_PER_MINUTE]), 'subject:ada');

    expect(await withBudgets(undefined, ada)?.pre?.(callInput('users.get'))).toEqual({ decision: 'allow' });
    expect(withBudgets(review, undefined)).toBe(review);
    expect(withBudgets(undefined, undefined)).toBeUndefined();
  });
});
