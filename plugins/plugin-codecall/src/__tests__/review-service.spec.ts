import type { PreReviewInput, ReviewDecision } from '@enclave-vm/core/worker';

import { codeCallReviewOptionsSchema } from '../codecall.types';
import CodeCallConfig from '../providers/code-call.config';
import { approvalQuestionOf, clientCanElicit } from '../review/approval-elicitation';
import { createRunReview, reviewContextOf, type RunReviewCaller } from '../review/create-run-review';
import { ReviewApprovals, type ApprovalServiceView } from '../review/review-approvals';
import { invocationScriptOf, reviewInvocation } from '../review/review-invocation';
import { reviewDecisionOf, reviewResultOf } from '../review/review-result';
import CodeCallReviewService, { type EnclaveReviewerFactories } from '../review/review.service';
import { RunReview } from '../review/run-review';

// Loading an Enclave entry for the first time in a test worker takes a few seconds.
jest.setTimeout(30000);

function reviewOptions(input: Record<string, unknown> = {}) {
  return codeCallReviewOptionsSchema.parse(input);
}

function fakeFactories(): EnclaveReviewerFactories & { functionReviewer: jest.Mock; providerReviewer: jest.Mock } {
  return {
    functionReviewer: jest.fn(() => async () => ({ decision: 'allow' })),
    providerReviewer: jest.fn(() => async () => ({ decision: 'allow' })),
  } as unknown as EnclaveReviewerFactories & { functionReviewer: jest.Mock; providerReviewer: jest.Mock };
}

const PROVIDER = { provider: 'openai', apiKey: 'sk-secret', model: 'gpt-test' };
const TOOLS = [{ name: 'users.list', description: 'Lists users' }];

describe('codeCallReviewOptionsSchema', () => {
  it('turns every rule on, with read-then-send asking for changes, and approvals counting for an hour', () => {
    expect(reviewOptions()).toEqual({
      rules: { inputSchema: true, availability: true, destructive: true, readThenSend: 'needs_changes', fanOut: true },
      approvalMaxAgeSeconds: 3600,
    });
    expect(reviewOptions({ rules: false }).rules).toBe(false);
  });

  it('needs a policy with a provider, and a function as the reviewer', () => {
    expect(codeCallReviewOptionsSchema.safeParse({ provider: PROVIDER }).success).toBe(false);
    expect(codeCallReviewOptionsSchema.safeParse({ provider: PROVIDER, policy: 'Read only' }).success).toBe(true);
    expect(codeCallReviewOptionsSchema.safeParse({ reviewer: 'not a function' }).success).toBe(false);
  });
});

describe('CodeCallReviewService', () => {
  it('versions the policy by what decides, never by the API key', () => {
    const version = (input: Record<string, unknown>) =>
      new CodeCallReviewService(reviewOptions(input), 'node-vm').policyVersion;

    expect(version({ provider: PROVIDER, policy: 'a' })).toBe(
      version({ provider: { ...PROVIDER, apiKey: 'sk-other' }, policy: 'a' }),
    );
    expect(version({ provider: PROVIDER, policy: 'a' })).not.toBe(version({ provider: PROVIDER, policy: 'b' }));
    expect(version({})).not.toBe(version({ rules: { fanOut: false } }));
    expect(version({})).not.toBe(version({ policyVersion: '2' }));
    expect(version({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has no reviewers without a provider or a function', async () => {
    const factories = fakeFactories();
    const service = new CodeCallReviewService(reviewOptions(), 'node-vm', async () => factories);

    expect(service.hasReviewers).toBe(false);
    expect(await service.reviewersFor(TOOLS)).toEqual([]);
  });

  it("makes the function reviewer, then the provider's, from the runtime's entry, again only when the tools change", async () => {
    const factories = fakeFactories();
    const load = jest.fn(async () => factories);
    const reviewer = async (): Promise<ReviewDecision> => ({ decision: 'allow' });
    const service = new CodeCallReviewService(
      reviewOptions({ provider: PROVIDER, reviewer, policy: 'Read only' }),
      'interpreter',
      load,
    );

    expect(service.hasReviewers).toBe(true);
    expect(await service.reviewersFor(TOOLS)).toHaveLength(2);
    await service.reviewersFor([...TOOLS]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('interpreter');
    expect(factories.functionReviewer).toHaveBeenCalledWith(reviewer, { policy: 'Read only', tools: TOOLS });
    expect(factories.providerReviewer).toHaveBeenCalledWith({ ...PROVIDER, policy: 'Read only', tools: TOOLS });

    await service.reviewersFor([{ name: 'mail.send', description: 'Sends mail' }]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it.each(['node-vm', 'interpreter'] as const)(
    "loads Enclave's reviewers from the %s runtime's entry",
    async (runtime) => {
      const reviewer = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'denied', reason: 'no' }));
      const service = new CodeCallReviewService(reviewOptions({ reviewer, policy: 'p' }), runtime);
      const [functionReviewer] = await service.reviewersFor(TOOLS);

      const input: PreReviewInput = {
        phase: 'script',
        code: 'return 1;',
        analysis: { toolCalls: [], flows: [], bounds: [], complete: true },
      };
      expect(await functionReviewer?.(input)).toEqual({ decision: 'denied', reason: 'no' });
    },
  );
});

describe('reviewResultOf and reviewDecisionOf', () => {
  const findings = [{ rule: 'r', message: 'm' }];
  const pending = { reference: { id: 'codecall:approval:x' } };

  it('gives each status its result', () => {
    expect(reviewResultOf({ status: 'review_failed', reason: 'down' })).toEqual({
      status: 'review_failed',
      error: { message: 'Review failed: down' },
    });
    expect(reviewResultOf({ status: 'needs_changes', findings })).toEqual({ status: 'needs_changes', findings });
    expect(reviewResultOf({ status: 'needs_changes' })).toEqual({ status: 'needs_changes', findings: [] });
    expect(reviewResultOf({ status: 'needs_approval', reason: 'person', findings }, pending)).toEqual({
      status: 'needs_approval',
      reason: 'person',
      approval: { id: 'codecall:approval:x' },
      findings,
    });
    expect(reviewResultOf({ status: 'needs_approval' })).toEqual({ status: 'needs_approval', reason: '' });
    expect(reviewResultOf({ status: 'denied', reason: 'no' })).toEqual({ status: 'denied', reason: 'no' });
    expect(reviewResultOf({ status: 'denied', reason: 'no', findings })).toEqual({
      status: 'denied',
      reason: 'no',
      findings,
    });
  });

  it("records a review status as the decision, and any other run's as allow", () => {
    expect(reviewDecisionOf({ status: 'denied', reason: 'no' })).toBe('denied');
    expect(reviewDecisionOf({ status: 'ok', result: 1 })).toBe('allow');
  });
});

describe('reviewInvocation', () => {
  function runReviewWith(pre: RunReview['pre']): RunReview {
    const review = new RunReview({
      reviewers: async () => [],
      approvals: new ReviewApprovals({ scriptHash: 'h', policyVersion: 'v', maxAgeMs: 1, granted: new Set() }),
    });
    Object.defineProperty(review, 'pre', { value: pre });
    return review;
  }

  it('stands for a one-call script with canonical arguments', () => {
    expect(invocationScriptOf('users.list', { b: 1, a: 2 })).toBe(
      'return await callTool("users.list", {"a":2,"b":1});',
    );
    expect(invocationScriptOf('users.list', undefined)).toBe('return await callTool("users.list", {});');
  });

  it('lets an allowed call run, and refuses a refused one', async () => {
    const code = invocationScriptOf('users.list', {});

    expect(
      await reviewInvocation(
        runReviewWith(async () => ({ decision: 'allow' })),
        code,
        {},
      ),
    ).toBeUndefined();
    expect(
      await reviewInvocation(
        runReviewWith(async () => ({ decision: 'denied', reason: 'no' })),
        code,
        {},
      ),
    ).toEqual({ status: 'denied', reason: 'no' });
  });

  it("fails the review with a reviewer's own message, or a fixed one", async () => {
    const code = invocationScriptOf('users.list', {});
    const reviewerError = Object.assign(new Error('The model answer is not JSON'), { name: 'ReviewerError' });

    expect(
      await reviewInvocation(
        runReviewWith(async () => {
          throw reviewerError;
        }),
        code,
        {},
      ),
    ).toEqual({ status: 'review_failed', error: { message: 'Review failed: The model answer is not JSON' } });
    expect(
      await reviewInvocation(
        runReviewWith(async () => {
          throw new Error('secret detail');
        }),
        code,
        {},
      ),
    ).toEqual({ status: 'review_failed', error: { message: 'Review failed: The review hook threw' } });
  });
});

describe('approval elicitation', () => {
  function scopeWith(enabled: boolean, capabilities?: Record<string, unknown>) {
    return {
      metadata: { elicitation: { enabled } },
      notifications: { getClientCapabilities: jest.fn(() => capabilities) },
    } as unknown as Parameters<typeof clientCanElicit>[0];
  }
  const context = (extra: Record<string, unknown> = {}) =>
    ({ sessionId: 's-1', ...extra }) as unknown as Parameters<typeof clientCanElicit>[1];

  it('asks only when the server enables elicitation and the client declared it', () => {
    expect(clientCanElicit(scopeWith(false, { elicitation: {} }), context())).toBe(false);
    expect(clientCanElicit(scopeWith(true, { elicitation: {} }), undefined)).toBe(false);
    expect(clientCanElicit(scopeWith(true, {}), context())).toBe(false);
    expect(clientCanElicit(scopeWith(true, { elicitation: {} }), context())).toBe(true);
  });

  it('reads the declaration of the request under protocol 2026-07-28', () => {
    const exchange = (supported: boolean) => ({ getMrtrExchange: () => ({ supportsElicitation: () => supported }) });

    expect(clientCanElicit(scopeWith(true), context(exchange(true)))).toBe(true);
    expect(clientCanElicit(scopeWith(true), context(exchange(false)))).toBe(false);
  });

  it('shows the person the tool and its arguments, cut when long, or asks about the script', () => {
    const reference = { id: 'codecall:approval:x' };

    expect(approvalQuestionOf('Needs a person', { reference })).toBe('Needs a person\n\nAllow this script to run?');
    expect(
      approvalQuestionOf('Destructive', { reference, call: { toolName: 'users.close', args: { id: 'u1' } } }),
    ).toBe('Destructive\n\nTool: users.close\nArguments: {"id":"u1"}\n\nAllow this call?');
    const long = approvalQuestionOf('D', { reference, call: { toolName: 't', args: { text: 'x'.repeat(600) } } });
    expect(long).toMatch(/Arguments: \{"text":"x+\.\.\.\n/);
    expect(approvalQuestionOf('D', { reference, call: { toolName: 't', args: undefined } })).toContain(
      'Arguments: undefined',
    );
  });
});

describe('createRunReview', () => {
  const closeTool = {
    name: 'users.close',
    fullName: 'crm:users.close',
    metadata: { description: 'Closes an account', annotations: { destructiveHint: true } },
    getInputJsonSchema: () => ({ type: 'object', properties: { id: { type: 'string' } } }),
  };
  const scope = { tools: { getTools: () => [closeTool] } } as unknown as RunReviewCaller['scope'];
  const closeInput: PreReviewInput = {
    phase: 'call',
    toolName: 'users.close',
    args: { id: 'u1' },
    callIndex: 0,
    analysis: { toolCalls: [], flows: [], bounds: [], complete: true },
  };

  function callerWith(overrides: Partial<RunReviewCaller> = {}): RunReviewCaller {
    return { scope, config: new CodeCallConfig({}), authInfo: {}, canElicit: false, granted: new Set(), ...overrides };
  }

  it("reads a context-specific grant in the caller's approval context", async () => {
    const service = new CodeCallReviewService(reviewOptions(), 'node-vm');
    const context = { type: 'repo', identifier: 'crm' };
    const approvalService: ApprovalServiceView = {
      queryApprovals: async () => [{ state: 'approved', scope: 'context_specific', grantedAt: Date.now(), context }],
    };

    const inContext = await createRunReview(
      service,
      callerWith({ approvalService, authInfo: { extra: { approvalContext: context } } }),
      'h',
    );
    const elsewhere = await createRunReview(service, callerWith({ approvalService }), 'h');

    expect(await inContext.pre(closeInput)).toEqual({ decision: 'allow' });
    expect((await elsewhere.pre(closeInput)).decision).toBe('needs_approval');
  });

  it('denies a destructive call without the Approval plugin or elicitation, and asks with elicitation', async () => {
    const service = new CodeCallReviewService(reviewOptions(), 'node-vm');

    expect((await (await createRunReview(service, callerWith(), 'h')).pre(closeInput)).decision).toBe('denied');
    expect(
      (await (await createRunReview(service, callerWith({ canElicit: true }), 'h')).pre(closeInput)).decision,
    ).toBe('needs_approval');
  });

  it("gives the server's reviewers the tools CodeCall may call, and runs no rule with rules off", async () => {
    const reviewer = jest.fn(async (): Promise<ReviewDecision> => ({ decision: 'allow' }));
    const factories = fakeFactories();
    const service = new CodeCallReviewService(
      reviewOptions({ rules: false, reviewer }),
      'node-vm',
      async () => factories,
    );
    const review = await createRunReview(service, callerWith(), 'h');

    expect(await review.pre(closeInput)).toEqual({ decision: 'allow' });
    await review.pre({ phase: 'script', code: 'return 1;', analysis: closeInput.analysis });
    expect(factories.functionReviewer).toHaveBeenCalledWith(reviewer, {
      policy: '',
      tools: [{ name: 'users.close', description: 'Closes an account' }],
    });
  });

  it('passes the hooks the session, the signed-in subject and the surface', () => {
    const verified = { tryGetContext: () => ({ verifiedSessionId: 's-1' }) };

    expect(reviewContextOf({ ...verified, auth: { isAnonymous: false, user: { sub: 'u-1' } } }, 'mcp')).toEqual({
      session: 's-1',
      subject: 'u-1',
      surface: 'mcp',
    });
    expect(
      reviewContextOf({ tryGetContext: () => undefined, auth: { isAnonymous: true, user: {} } }, undefined),
    ).toEqual({ session: null, subject: null, surface: null });
    expect(reviewContextOf({ ...verified, auth: { isAnonymous: false, user: {} } }, undefined).subject).toBeNull();
  });
});
