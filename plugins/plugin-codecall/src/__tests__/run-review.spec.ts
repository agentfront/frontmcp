import { analyzeScript, type PreReviewInput, type ReviewDecision, type ReviewRecord } from '@enclave-vm/core/worker';

import { codeCallReviewRulesSchema } from '../codecall.types';
import { ReviewApprovals, type ApprovalServiceView } from '../review/review-approvals';
import { ReviewRules } from '../review/review-rules';
import { refusalsEndedWith, reviewOutcomeOf, RunReview, type CodeCallPreReviewer } from '../review/run-review';

function record(overrides: Partial<ReviewRecord>): ReviewRecord {
  return { phase: 'script', decision: 'allow', durationMs: 1, ...overrides };
}

const CLOSE = {
  name: 'users.close',
  annotations: { destructiveHint: true },
  inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
};

function approvalsWith(service?: ApprovalServiceView, granted: string[] = []): ReviewApprovals {
  return new ReviewApprovals({
    scriptHash: 'h',
    policyVersion: 'v',
    maxAgeMs: 60_000,
    service,
    granted: new Set(granted),
  });
}

function reviewWith(options: {
  reviewers?: CodeCallPreReviewer[];
  approvals?: ReviewApprovals;
  rules?: boolean;
  timeoutMs?: number;
  effectsSoFar?: () => readonly string[];
  canPause?: () => boolean;
  hasApprovalChannel?: boolean;
  replaysRecord?: boolean;
}): RunReview {
  const rules = options.rules
    ? new ReviewRules({
        rules: codeCallReviewRulesSchema.parse({}),
        toolOf: (name) => (name === 'users.close' ? CLOSE : { name, inputSchema: null }),
        hasApprovalChannel: true,
      })
    : undefined;
  return new RunReview({
    rules,
    reviewers: async () => options.reviewers ?? [],
    approvals: options.approvals ?? approvalsWith(),
    timeoutMs: options.timeoutMs,
    hasApprovalChannel: options.hasApprovalChannel ?? true,
    effectsSoFar: options.effectsSoFar,
    canPause: options.canPause,
    replaysRecord: options.replaysRecord,
  });
}

function scriptInput(code: string): PreReviewInput {
  return { phase: 'script', code, analysis: analyzeScript(code) };
}

describe('reviewOutcomeOf', () => {
  it('reports a failed review first', () => {
    expect(
      reviewOutcomeOf([
        record({ decision: 'needs_changes', findings: [{ rule: 'r', message: 'm' }] }),
        record({ phase: 'call', decision: 'review_failed', reason: 'down' }),
      ]),
    ).toEqual({ status: 'review_failed', reason: 'down', phase: 'call' });
  });

  it('reports a refused script, and a call that stopped the run for approval', () => {
    expect(reviewOutcomeOf([record({ decision: 'denied', reason: 'no' })])).toEqual({ status: 'denied', reason: 'no' });
    expect(
      reviewOutcomeOf([record({}), record({ phase: 'call', decision: 'needs_approval', reason: 'person' })]),
    ).toEqual({ status: 'needs_approval', reason: 'person' });
  });

  it('reports a refused call only when it ended the run, by its ReviewError', () => {
    const decisions = [
      record({}),
      record({ phase: 'call', decision: 'denied', reason: 'first' }),
      record({ phase: 'call', decision: 'needs_changes', findings: [{ rule: 'r', message: 'last' }] }),
    ];

    expect(reviewOutcomeOf(decisions, { name: 'ReviewError' })).toEqual({
      status: 'needs_changes',
      findings: [{ rule: 'r', message: 'last' }],
    });
    expect(reviewOutcomeOf(decisions, { name: 'Error' })).toBeUndefined();
    expect(reviewOutcomeOf(decisions)).toBeUndefined();
  });

  it('reports the refused call whose message the ReviewError has, of several refused in a parallel()', () => {
    const decisions = [
      record({ phase: 'call', toolName: 'orders.void', callIndex: 1, decision: 'denied', reason: 'first' }),
      record({ phase: 'call', toolName: 'orders.void', callIndex: 3, decision: 'denied', reason: 'second' }),
    ];

    expect(
      reviewOutcomeOf(decisions, { name: 'ReviewError', message: 'Review denied the call to orders.void: first' }),
    ).toEqual({ status: 'denied', reason: 'first', callIndex: 1 });
  });

  it('reports the first refused call a failed parallel() listed, and none the list leaves out', () => {
    const decisions = [
      record({ phase: 'call', toolName: 'orders.note', callIndex: 0, decision: 'denied', reason: 'caught' }),
      record({
        phase: 'call',
        toolName: 'orders.void',
        callIndex: 3,
        decision: 'needs_changes',
        findings: [{ rule: 'input-schema', message: 'orders.void: id must be a string', suggestion: 'Quote it' }],
      }),
      record({ phase: 'call', toolName: 'orders.void', callIndex: 2, decision: 'denied', reason: 'refused' }),
    ];
    const message =
      '2 of 4 parallel operations failed:\nReview asks for changes to the call to orders.void: orders.void: id must ' +
      'be a string (Quote it)\nReview denied the call to orders.void: refused';

    expect(reviewOutcomeOf(decisions, { name: 'Error', message })).toEqual({
      status: 'denied',
      reason: 'refused',
      callIndex: 2,
    });
    expect(reviewOutcomeOf(decisions, { name: 'Error', message: '1 of 4 parallel operations failed:\nboom' })).toBe(
      undefined,
    );
  });
});

describe('refusalsEndedWith', () => {
  const refusals = [
    record({ phase: 'call', toolName: 'orders.void', callIndex: 3, decision: 'denied', reason: 'no' }),
    record({ phase: 'call', toolName: 'orders.void', callIndex: 1, decision: 'denied', reason: 'not allowed' }),
  ];

  it('names only the refusals whose whole message the error carries, in call order', () => {
    const listed = '2 of 4 parallel operations failed:\nReview denied the call to orders.void: not allowed\nboom';

    expect(refusalsEndedWith(refusals, { name: 'Error', message: listed }).map((r) => r.callIndex)).toEqual([1]);
    expect(
      refusalsEndedWith(refusals, { name: 'ReviewError', message: 'Review denied the call to orders.void: no' }).map(
        (r) => r.callIndex,
      ),
    ).toEqual([3]);
  });

  it('names none for a ReviewError whose message is no refusal of the run, or any other error', () => {
    expect(refusalsEndedWith(refusals, { name: 'ReviewError', message: 'Review denied the call to x: no' })).toEqual(
      [],
    );
    expect(
      refusalsEndedWith(refusals, { name: 'Error', message: 'Review denied the call to orders.void: no' }),
    ).toEqual([]);
    expect(refusalsEndedWith(refusals)).toEqual([]);
  });
});

describe('RunReview', () => {
  it("passes Enclave its pre hook, and the server's timeout when set", () => {
    expect(reviewWith({}).hooks).toEqual({ pre: expect.any(Function) });
    expect(reviewWith({ timeoutMs: 500 }).hooks).toEqual({ pre: expect.any(Function), timeoutMs: 500 });
  });

  it('allows a script and its calls with no rules and no reviewers', async () => {
    const review = reviewWith({});

    expect(await review.pre(scriptInput('return 1;'))).toEqual({ decision: 'allow' });
    expect(
      await review.pre({ phase: 'call', toolName: 'a', args: {}, callIndex: 0, analysis: analyzeScript('return 1;') }),
    ).toEqual({ decision: 'allow' });
  });

  it('asks the reviewers in order, after the rules, until one refuses', async () => {
    const first = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'allow' }));
    const second = jest.fn(
      async (): Promise<ReviewDecision> => ({ decision: 'needs_changes', findings: [{ rule: 'r', message: 'm' }] }),
    );
    const third = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'allow' }));

    const decision = await reviewWith({ reviewers: [first, second, third], rules: true }).pre(
      scriptInput("return await callTool('users.list', {});"),
    );

    expect(decision).toEqual({ decision: 'needs_changes', findings: [{ rule: 'r', message: 'm' }] });
    expect(first).toHaveBeenCalled();
    expect(third).not.toHaveBeenCalled();
  });

  it('does not ask the reviewers about a call: they review scripts', async () => {
    const reviewer = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'denied', reason: 'no' }));

    const decision = await reviewWith({ reviewers: [reviewer] }).pre({
      phase: 'call',
      toolName: 'users.list',
      args: {},
      callIndex: 0,
      analysis: analyzeScript('return 1;'),
    });

    expect(decision).toEqual({ decision: 'allow' });
    expect(reviewer).not.toHaveBeenCalled();
  });

  it("turns a reviewer's needs_approval into a script-wide approval reference, and lets an approved script run", async () => {
    const reviewer = async (): Promise<ReviewDecision> => ({ decision: 'needs_approval', reason: 'A person decides' });
    const pending = reviewWith({ reviewers: [reviewer] });

    expect(await pending.pre(scriptInput('return 1;'))).toEqual({
      decision: 'needs_approval',
      reason: 'A person decides',
    });
    const reference = pending.pendingApproval?.reference;
    expect(reference).toEqual({ id: expect.stringMatching(/^codecall:approval:/) });
    expect(pending.pendingApproval?.call).toBeUndefined();

    const approved = reviewWith({
      reviewers: [reviewer],
      approvals: approvalsWith(undefined, [reference?.id as string]),
    });
    expect(await approved.pre(scriptInput('return 1;'))).toEqual({ decision: 'allow' });
  });

  it("denies a reviewer's needs_approval when nobody can approve, and keeps no pending approval", async () => {
    const reviewer = async (): Promise<ReviewDecision> => ({ decision: 'needs_approval', reason: 'A person decides' });
    const review = reviewWith({ reviewers: [reviewer], hasApprovalChannel: false });

    const decision = await review.pre(scriptInput('return 1;'));

    expect(decision).toEqual({
      decision: 'denied',
      reason:
        'A person decides; nobody can approve it here: the server has no Approval plugin, and the client does not support elicitation',
    });
    expect(review.pendingApproval).toBeUndefined();
  });

  it("still honours a grant for a reviewer's needs_approval when nobody could ask again", async () => {
    const reviewer = async (): Promise<ReviewDecision> => ({ decision: 'needs_approval', reason: 'A person decides' });
    const id = approvalsWith().referenceFor().id;
    const review = reviewWith({
      reviewers: [reviewer],
      hasApprovalChannel: false,
      approvals: approvalsWith(undefined, [id]),
    });

    expect(await review.pre(scriptInput('return 1;'))).toEqual({ decision: 'allow' });
  });

  it('denies a destructive call a person refused', async () => {
    const reference = approvalsWith().referenceFor({ toolName: 'users.close', args: { id: 'u1' } });
    const service: ApprovalServiceView = {
      queryApprovals: async ({ toolId }) =>
        toolId === reference.id ? [{ state: 'denied', scope: 'session', grantedAt: Date.now() }] : [],
    };

    const decision = await reviewWith({ rules: true, approvals: approvalsWith(service) }).pre({
      phase: 'call',
      toolName: 'users.close',
      args: { id: 'u1' },
      callIndex: 0,
      analysis: analyzeScript('return 1;'),
    });

    expect(decision).toEqual({
      decision: 'denied',
      reason:
        'Tool "users.close" is destructive: it runs once a person approves this call; a person refused the approval',
    });
  });

  it('keeps the call a needs_approval refers to', async () => {
    const review = reviewWith({ rules: true });

    await review.pre(scriptInput("return await callTool('users.close', { id: 'u9' });"));

    expect(review.pendingApproval).toEqual({
      reference: expect.objectContaining({ toolName: 'users.close' }),
      call: { toolName: 'users.close', args: { id: 'u9' } },
    });
  });

  it('asks for a script of its own, not an approval, for a call after tools with effects ran', async () => {
    const review = reviewWith({ rules: true, effectsSoFar: () => ['mail.send', 'crm.note'] });

    const decision = await review.pre({
      phase: 'call',
      toolName: 'users.close',
      args: { id: 'u1' },
      callIndex: 2,
      analysis: analyzeScript('return 1;'),
    });

    expect(decision).toEqual({
      decision: 'needs_changes',
      findings: [
        expect.objectContaining({
          rule: 'approval-after-effects',
          toolName: 'users.close',
          suggestion:
            'mail.send, crm.note already ran; send only users.close and the calls after it, in a script of their own',
        }),
      ],
    });
    expect(review.pendingApproval).toBeUndefined();
  });

  it('asks for the approval after tools with effects ran in a run that can pause there', async () => {
    const review = reviewWith({ rules: true, effectsSoFar: () => ['mail.send'], canPause: () => true });

    const decision = await review.pre({
      phase: 'call',
      toolName: 'users.close',
      args: { id: 'u1' },
      callIndex: 1,
      analysis: analyzeScript('return 1;'),
    });

    expect(decision.decision).toBe('needs_approval');
    expect(review.pendingApproval).toMatchObject({ call: { toolName: 'users.close', args: { id: 'u1' } } });
  });

  it('names at most ten earlier tools', async () => {
    const tools = Array.from({ length: 12 }, (_, index) => `tool.${index}`);
    const review = reviewWith({ rules: true, effectsSoFar: () => tools });

    const decision = await review.pre({
      phase: 'call',
      toolName: 'users.close',
      args: { id: 'u1' },
      callIndex: 12,
      analysis: analyzeScript('return 1;'),
    });

    expect(decision.decision === 'needs_changes' && decision.findings[0]?.suggestion).toBe(
      `${tools.slice(0, 10).join(', ')} and 2 more already ran; send only users.close and the calls after it, in a script of their own`,
    );
  });

  it('still asks for approval before the script runs, whatever ran in other runs', async () => {
    const review = reviewWith({ rules: true, effectsSoFar: () => ['mail.send'] });

    const decision = await review.pre(scriptInput("return await callTool('users.close', { id: 'u1' });"));

    expect(decision.decision).toBe('needs_approval');
  });

  it('leaves the approvals of a script it replays to each live call, which it still asks', async () => {
    const review = reviewWith({ rules: true, replaysRecord: true });

    const script = await review.pre(scriptInput("return await callTool('users.close', { id: 'u1' });"));
    const call = await review.pre({
      phase: 'call',
      toolName: 'users.close',
      args: { id: 'u1' },
      callIndex: 0,
      analysis: analyzeScript('return 1;'),
    });

    expect(script.decision).toBe('allow');
    expect(call.decision).toBe('needs_approval');
  });
});
