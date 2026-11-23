import type {
  PreReviewInput,
  ReviewDecision,
  ReviewFinding,
  ReviewOptions,
  ReviewRecord,
} from '@enclave-vm/core/worker';

import type { CodeCallApprovalReference, ReviewApprovals } from './review-approvals';
import type { ApprovalCall, ReviewRules, RulesVerdict } from './review-rules';

/** A `pre` hook of Enclave's review: CodeCall's own, or a reviewer the server configured. */
export type CodeCallPreReviewer = (input: PreReviewInput) => Promise<ReviewDecision>;

/** The statuses a review gives `codecall:execute`. */
export type CodeCallReviewStatus = 'needs_changes' | 'needs_approval' | 'denied' | 'review_failed';

/** How the review ended a run. */
export interface CodeCallReviewOutcome {
  status: CodeCallReviewStatus;
  reason?: string;
  findings?: ReviewFinding[];
}

export interface RunReviewOptions {
  rules?: ReviewRules;
  /** The server's reviewers, asked after the rules allow a script; loaded when first asked. */
  reviewers: () => Promise<readonly CodeCallPreReviewer[]>;
  approvals: ReviewApprovals;
  /** How long one review hook may take, in ms; Enclave's default when unset. */
  timeoutMs?: number;
}

const ALLOW: ReviewDecision = { decision: 'allow' };
const REVIEW_ERROR_NAME = 'ReviewError';

function isCallRefusal(record: ReviewRecord): boolean {
  return record.phase === 'call' && (record.decision === 'denied' || record.decision === 'needs_changes');
}

/**
 * How the review ended a run, from Enclave's record of its decisions: a failed review, a refused script, a call that
 * needs approval (which stops the run), or a refused call the script did not catch. Undefined when the review let the
 * run end on its own.
 */
export function reviewOutcomeOf(
  decisions: readonly ReviewRecord[],
  runError?: { name?: string },
): CodeCallReviewOutcome | undefined {
  const failed = decisions.find((record) => record.decision === 'review_failed');
  if (failed) return { status: 'review_failed', reason: failed.reason };
  const stopping = decisions.find(
    (record) => record.decision === 'needs_approval' || (record.phase === 'script' && record.decision !== 'allow'),
  );
  const uncaught = runError?.name === REVIEW_ERROR_NAME ? [...decisions].reverse().find(isCallRefusal) : undefined;
  const refusal = stopping ?? uncaught;
  if (!refusal) return undefined;
  return {
    status: refusal.decision as CodeCallReviewStatus,
    ...(refusal.reason !== undefined && { reason: refusal.reason }),
    ...(refusal.findings && { findings: refusal.findings }),
  };
}

/** The approval a `needs_approval` refers to, with the call it covers when a rule asked for it. */
export interface PendingApproval {
  reference: CodeCallApprovalReference;
  call?: ApprovalCall;
}

/** The review of one run: the built-in rules, then the server's reviewers, with the approvals people granted. */
export class RunReview {
  /** The approval a `needs_approval` of this run refers to, with the call it covers. */
  pendingApproval?: PendingApproval;

  constructor(private readonly options: RunReviewOptions) {}

  /** Enclave's `review` option for the run. */
  get hooks(): ReviewOptions {
    const { timeoutMs } = this.options;
    return { pre: this.pre, ...(timeoutMs !== undefined && { timeoutMs }) };
  }

  readonly pre = async (input: PreReviewInput): Promise<ReviewDecision> => {
    const verdict = this.rulesVerdictOf(input);
    if (verdict?.refusal) return verdict.refusal;
    for (const call of verdict?.approvalCalls ?? []) {
      const needsApproval = await this.approvalOfCall(call, input.phase === 'call');
      if (needsApproval) return needsApproval;
    }
    if (input.phase === 'call') return ALLOW;
    for (const reviewer of await this.options.reviewers()) {
      const decision = await reviewer(input);
      if (decision.decision === 'allow') continue;
      if (decision.decision !== 'needs_approval') return decision;
      const needsApproval = await this.approvalOf(
        { reference: this.options.approvals.referenceFor() },
        false,
        decision,
      );
      if (needsApproval) return needsApproval;
    }
    return ALLOW;
  };

  private rulesVerdictOf(input: PreReviewInput): RulesVerdict | undefined {
    const { rules } = this.options;
    if (!rules) return undefined;
    if (input.phase === 'script') return rules.reviewScript(input.analysis);
    return rules.reviewCall(input.toolName, input.args);
  }

  private approvalOfCall(call: ApprovalCall, consume: boolean): Promise<ReviewDecision | undefined> {
    const reference = this.options.approvals.referenceFor(call);
    return this.approvalOf({ reference, call }, consume, {
      decision: 'needs_approval',
      reason: `Tool "${call.toolName}" is destructive: it runs once a person approves this call`,
    });
  }

  /** Undefined when a person approved the reference; otherwise the decision that stops the run. */
  private async approvalOf(
    pending: PendingApproval,
    consume: boolean,
    request: Extract<ReviewDecision, { decision: 'needs_approval' }>,
  ): Promise<ReviewDecision | undefined> {
    const state = await this.options.approvals.stateOf(pending.reference, consume);
    if (state === 'approved') return undefined;
    if (state === 'denied') {
      return { ...request, decision: 'denied', reason: `${request.reason}; a person refused the approval` };
    }
    this.pendingApproval = pending;
    return request;
  }
}
