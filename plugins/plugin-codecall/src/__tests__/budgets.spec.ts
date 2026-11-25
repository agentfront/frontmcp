/** Budget counts per caller in fixed windows of shared storage: looked at before each call, spent and counted at dispatch. */
import type { PreReviewInput, ReviewDecision } from '@enclave-vm/core/worker';

import { createRootStorage, MemoryStorageAdapter, type NamespacedStorage } from '@frontmcp/utils';

import {
  BUDGET_EXCEEDED_RULE,
  BUDGET_UNAVAILABLE_RULE,
  budgetCallerOf,
  BudgetMeter,
  withBudgets,
  type BudgetCall,
} from '../budgets/budget-meter';
import { CodeCallBudgetStore } from '../budgets/budget-store';
import { codeCallBudgetsOptionsSchema, type CodeCallBudget } from '../codecall.types';
import { ReviewApprovals, type ApprovalRecordView } from '../review/review-approvals';

const HOUR = 3600;
const MAX_AGE_MS = 3_600_000;
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
const CALLS_PER_HOUR: CodeCallBudget = { ...CALLS_PER_MINUTE, name: 'calls-per-hour', onExceeded: 'needs_approval' };
const ARCHIVE: BudgetCall = { toolName: 'users.archive', args: { ids: ['t1'] }, callIndex: 2 };

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

/** The approvals of one script, with the states a person gave approval ids in the Approval plugin at `grantedAt`. */
function approvalsWith(states: Record<string, ApprovalRecordView['state']>, grantedAt: number) {
  const queryApprovals = async ({ toolId }: { toolId: string }): Promise<ApprovalRecordView[]> => {
    const state = states[toolId];
    return state ? [{ state, scope: 'session', grantedAt, metadata: { maxCalls: 10 } }] : [];
  };
  return new ReviewApprovals({
    scriptHash: 'script-hash',
    policyVersion: 'policy',
    maxAgeMs: MAX_AGE_MS,
    service: { queryApprovals },
    granted: new Set(),
  });
}

function meterFor(
  store: CodeCallBudgetStore,
  caller: string,
  { approvals = approvalsWith({}, Date.now()), grantedByPerson = new Set<string>(), canApprove = true } = {},
): BudgetMeter {
  return new BudgetMeter(store, caller, { approvals, grantedByPerson, canApprove });
}

const referenceOf = (budget: string, call: BudgetCall = ARCHIVE) =>
  approvalsWith({}, Date.now()).budgetReferenceFor(call, budget);

async function decisionOf(meter: BudgetMeter, call: BudgetCall = ARCHIVE): Promise<ReviewDecision> {
  return (await meter.check(call)).decision;
}

/** Calls that ran: each admitted as its tool starts, then ended with the records it reported. */
async function useCalls(meter: BudgetMeter, records: number, calls = 1): Promise<void> {
  for (let index = 0; index < calls; index++) {
    const call = meter.startCall({ toolName: 'users.archive', args: { index }, callIndex: index });
    await call.dispatch.beforeExecute();
    call.dispatch.onRecordsChanged(records);
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
    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
    await useCalls(ada, 80);

    const decision = await decisionOf(ada);
    expect(decision).toMatchObject({ decision: 'needs_approval', reason: expect.stringContaining('records-per-hour') });
    expect(decision.findings).toEqual([
      expect.objectContaining({ rule: BUDGET_EXCEEDED_RULE, toolName: 'users.archive' }),
    ]);
    expect(await decisionOf(meterFor(store, 'subject:bob'))).toEqual({ decision: 'allow' });
  });

  it('holds the counts across two instances sharing one storage adapter', async () => {
    const first = meterFor(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');
    const second = meterFor(new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock), 'subject:ada');

    await useCalls(first, 0);
    await useCalls(second, 0);

    expect(await decisionOf(first)).toMatchObject({ decision: 'denied' });
    expect(await decisionOf(second)).toMatchObject({ decision: 'denied' });
  });

  it('starts again in the next window, and keeps a count for at least its window', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0, 2);
    now += 30_000;

    expect(await decisionOf(ada)).toMatchObject({
      decision: 'denied',
      findings: [expect.objectContaining({ message: expect.stringContaining('resets in 30 seconds') })],
    });
    const [key] = await storage.keys('*');
    expect(await storage.ttl(key)).toBeGreaterThan(55);

    now += 30_000;
    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
  });

  it('counts a call as a tool call only once its tool started, and its records when it ends', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');

    await ada.startCall(ARCHIVE).end();
    await ada.startCall(ARCHIVE).end();
    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });

    await useCalls(ada, 0, 2);
    expect(await decisionOf(ada)).toMatchObject({ decision: 'denied' });
  });

  it('stops a call as it enters its tool when the window filled up after the call was looked at', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0);
    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
    const call = ada.startCall(ARCHIVE);

    await useCalls(meterFor(store, 'subject:ada'), 0);

    await expect(call.dispatch.beforeExecute()).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(call.refusal?.decision).toMatchObject({ decision: 'denied' });
  });

  it('counts the records of a call once, and no report after it ended', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = meterFor(store, 'subject:ada');
    const call = ada.startCall(ARCHIVE);
    call.dispatch.onRecordsChanged(150);
    await call.end();
    await call.end();
    call.dispatch.onRecordsChanged(150);

    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
  });

  it.each([[-1], [1.5], [Number.NaN]])(
    'refuses a report of %p records, so the call fails and no count drops',
    async (count) => {
      const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
      const ada = meterFor(store, 'subject:ada');
      await useCalls(ada, 200);
      const call = ada.startCall(ARCHIVE);

      expect(() => call.dispatch.onRecordsChanged(count)).toThrow(RangeError);
      await call.end();
      expect(await decisionOf(ada)).toMatchObject({ decision: 'needs_approval' });
    },
  );

  it("never stops CodeCall's reserved names, such as keep and recall", async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0, 2);

    expect(await decisionOf(ada, { toolName: 'codecall:recall', args: {} })).toEqual({ decision: 'allow' });
    expect(await decisionOf(ada, { toolName: 'codecall:keep', args: {} })).toEqual({ decision: 'allow' });
  });

  it('treats a stored count that is not a number as reached', async () => {
    const store = new CodeCallBudgetStore(storage, [CALLS_PER_MINUTE], clock);
    const ada = meterFor(store, 'subject:ada');
    await useCalls(ada, 0);
    const [key] = await storage.keys('*');
    await storage.set(key, 'not-a-count');

    expect(await decisionOf(ada)).toMatchObject({ decision: 'denied' });
  });

  it('denies the call when the counts cannot be read', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    jest.spyOn(storage, 'mget').mockRejectedValueOnce(new Error('connection refused'));

    expect(await decisionOf(meterFor(store, 'subject:ada'))).toMatchObject({
      decision: 'denied',
      findings: [{ rule: BUDGET_UNAVAILABLE_RULE }],
    });
  });

  it('denies the rest of the run once a count could not be kept', async () => {
    const store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], clock);
    const ada = meterFor(store, 'subject:ada');
    jest.spyOn(storage, 'incrBy').mockRejectedValueOnce(new Error('connection refused'));

    await useCalls(ada, 10);

    expect(await decisionOf(ada)).toMatchObject({ decision: 'denied' });
  });
});

describe('budget approvals', () => {
  let grantedAt: number;
  let storage: NamespacedStorage;
  let store: CodeCallBudgetStore;
  const recordsReference = () => referenceOf('records-per-hour');
  const approvedAs = (id: string) => approvalsWith({ [id]: 'approved' }, grantedAt);

  beforeEach(async () => {
    grantedAt = Date.now() - 600_000;
    storage = await sharedStorage();
    store = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR]);
    await useCalls(meterFor(store, 'subject:ada'), 200);
  });

  it('asks for the call over the budget with a reference shaped as a review approval, for that call only', async () => {
    const ada = meterFor(store, 'subject:ada');
    const verdict = await ada.check(ARCHIVE);

    expect(verdict.decision).toMatchObject({ decision: 'needs_approval' });
    expect(verdict.pending?.reference).toEqual({
      id: expect.stringMatching(/^codecall:approval:[0-9a-f]{64}$/),
      toolName: ARCHIVE.toolName,
      argumentsHash: approvalsWith({}, grantedAt).referenceFor(ARCHIVE).argumentsHash,
    });
    expect(verdict.pending?.call).toEqual({ toolName: ARCHIVE.toolName, args: ARCHIVE.args });
    expect(ada.pendingApprovalAt(ARCHIVE.callIndex)).toBe(verdict.pending);
    expect(verdict.pending?.reference.id).not.toBe(approvalsWith({}, grantedAt).referenceFor(ARCHIVE).id);
  });

  it('binds an approval to the call at its place in the run', async () => {
    const grantedByPerson = new Set([recordsReference().id]);
    const ada = meterFor(store, 'subject:ada', { grantedByPerson });

    const firstIdenticalCall = await ada.check({ ...ARCHIVE, callIndex: 0 });

    expect(firstIdenticalCall.decision).toMatchObject({ decision: 'needs_approval' });
    expect(firstIdenticalCall.pending?.reference.id).not.toBe(recordsReference().id);
    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
  });

  it('looks at a grant before the call and spends it only as the call enters its tool, counting the call', async () => {
    const grantedByPerson = new Set([recordsReference().id]);
    const ada = meterFor(store, 'subject:ada', { grantedByPerson });

    expect(await decisionOf(ada)).toEqual({ decision: 'allow' });
    expect(grantedByPerson.size).toBe(1);
    await ada.startCall(ARCHIVE).dispatch.beforeExecute();

    expect(grantedByPerson.size).toBe(0);
    expect(await decisionOf(ada)).toMatchObject({ decision: 'needs_approval' });
  });

  it('spends an Approval plugin grant once, never in a later run, and takes a new grant as new', async () => {
    const approvals = approvedAs(recordsReference().id);
    await meterFor(store, 'subject:ada', { approvals }).startCall(ARCHIVE).dispatch.beforeExecute();

    expect(await decisionOf(meterFor(store, 'subject:ada', { approvals }))).toMatchObject({
      decision: 'needs_approval',
    });
    const regranted = approvalsWith({ [recordsReference().id]: 'approved' }, grantedAt + 1);
    expect(await decisionOf(meterFor(store, 'subject:ada', { approvals: regranted }))).toEqual({ decision: 'allow' });
  });

  it('lets only one of two concurrent runs on instances sharing a store spend one grant', async () => {
    const second = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR]);
    const approvals = approvedAs(recordsReference().id);

    const admissions = await Promise.allSettled(
      [store, second].map((instance) =>
        meterFor(instance, 'subject:ada', { approvals }).startCall(ARCHIVE).dispatch.beforeExecute(),
      ),
    );

    expect(admissions.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('claims every grant a call needs together, and gives them back when one is lost to another call', async () => {
    const both = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR, CALLS_PER_HOUR]);
    const recordsId = recordsReference().id;
    const callsId = referenceOf('calls-per-hour').id;
    const approvals = approvalsWith({ [recordsId]: 'approved', [callsId]: 'approved' }, grantedAt);
    await useCalls(meterFor(both, 'subject:bob'), 100, 2);
    const bob = meterFor(both, 'subject:bob', { approvals });
    expect(await decisionOf(bob)).toEqual({ decision: 'allow' });

    await both.claim(`${callsId}:${grantedAt}`, grantedAt + MAX_AGE_MS);
    const call = bob.startCall(ARCHIVE);

    await expect(call.dispatch.beforeExecute()).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(call.refusal?.pending?.reference.id).toBe(callsId);
    expect(await both.isSpent(`${recordsId}:${grantedAt}`)).toBe(false);
  });

  it('spends no grant of a person until it has one for each budget the call is over', async () => {
    const both = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR, CALLS_PER_HOUR]);
    const recordsId = recordsReference().id;
    const callsId = referenceOf('calls-per-hour').id;
    const grantedByPerson = new Set([recordsId]);
    await useCalls(meterFor(both, 'subject:bob'), 100, 2);
    const bob = meterFor(both, 'subject:bob', { grantedByPerson });

    const verdict = await bob.check(ARCHIVE);
    expect(verdict.decision).toMatchObject({
      decision: 'needs_approval',
      reason: expect.stringContaining('calls-per'),
    });
    expect(verdict.pending?.reference.id).toBe(callsId);
    grantedByPerson.add(callsId);
    await bob.startCall(ARCHIVE).dispatch.beforeExecute();

    expect(grantedByPerson.size).toBe(0);
  });

  it("refuses a claim after the grant's deadline, and marks a spent grant no longer than it counts", async () => {
    const fixed = new CodeCallBudgetStore(storage, [RECORDS_PER_HOUR], () => grantedAt + 600_000);

    expect(await fixed.claim('expired-grant', grantedAt + 600_000)).toBeUndefined();
    const claims = await Promise.all([
      fixed.claim('grant-1', grantedAt + MAX_AGE_MS),
      fixed.claim('grant-1', grantedAt + MAX_AGE_MS),
    ]);

    expect(claims.filter((claimant) => claimant !== undefined)).toHaveLength(1);
    const [marker] = await storage.keys('grant.spent:*');
    expect(await storage.ttl(marker)).toBeLessThanOrEqual(3000);
    expect(await storage.ttl(marker)).toBeGreaterThanOrEqual(2999);
  });

  it('never lifts a budget with a destructive-call approval, nor approves a destructive call with a budget one', async () => {
    const reviewReference = approvalsWith({}, grantedAt).referenceFor(ARCHIVE);
    const approvals = approvalsWith(
      { [reviewReference.id]: 'approved', [reviewReference.anyArgumentsId as string]: 'approved' },
      grantedAt,
    );

    expect(await decisionOf(meterFor(store, 'subject:ada', { approvals }))).toMatchObject({
      decision: 'needs_approval',
    });
    expect(await approvedAs(recordsReference().id).stateOf(reviewReference, false)).toBe('missing');
  });

  it('denies a call a person refused to approve over the budget', async () => {
    const approvals = approvalsWith({ [recordsReference().id]: 'denied' }, grantedAt);

    expect(await decisionOf(meterFor(store, 'subject:ada', { approvals }))).toMatchObject({
      decision: 'denied',
      reason: expect.stringContaining('a person refused to approve it'),
    });
  });

  it('denies a call over the budget when nobody can approve it', async () => {
    const verdict = await meterFor(store, 'subject:ada', { canApprove: false }).check(ARCHIVE);

    expect(verdict.decision).toMatchObject({
      decision: 'denied',
      reason: expect.stringContaining('nobody can approve it here'),
    });
    expect(verdict.pending).toBeUndefined();
  });
});

describe('withBudgets', () => {
  it('asks the budgets before the review at each call, and only the review for the script', async () => {
    const store = new CodeCallBudgetStore(await sharedStorage(), [{ ...CALLS_PER_MINUTE, limit: 1 }]);
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
