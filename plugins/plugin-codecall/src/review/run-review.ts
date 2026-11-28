import type {
  PreReviewInput,
  ReviewDecision,
  ReviewFinding,
  ReviewOptions,
  ReviewRecord,
} from '@enclave-vm/core/worker';

import { parallelFailuresOf } from '../utils/parallel-failure';
import type { CodeCallApprovalReference, ReviewApprovals } from './review-approvals';
import { NO_APPROVAL_CHANNEL, type ApprovalCall, type ReviewRules, type RulesVerdict } from './review-rules';

/** A `pre` hook of Enclave's review: CodeCall's own, or a reviewer the server configured. */
export type CodeCallPreReviewer = (input: PreReviewInput) => Promise<ReviewDecision>;

/** The statuses a review gives `codecall:execute`. */
export type CodeCallReviewStatus = 'needs_changes' | 'needs_approval' | 'denied' | 'review_failed';

/** How the review ended a run. */
export interface CodeCallReviewOutcome {
  status: CodeCallReviewStatus;
  reason?: string;
  findings?: ReviewFinding[];
  /** Where a failed review failed: before the script (`script`), or at a call, after the calls before it ran. */
  phase?: ReviewRecord['phase'];
  /** The place in the run of the call it stopped at. */
  callIndex?: number;
}

export interface RunReviewOptions {
  rules?: ReviewRules;
  /** The server's reviewers, asked after the rules allow a script; loaded when first asked. */
  reviewers: () => Promise<readonly CodeCallPreReviewer[]>;
  approvals: ReviewApprovals;
  /** How long one review hook may take, in ms; Enclave's default when unset. */
  timeoutMs?: number;
  /** Whether a person can approve: the Approval plugin is installed, or the client can answer an elicitation. */
  hasApprovalChannel: boolean;
  /** The tools that are not read-only and have already run in this run, in the order they first ran. */
  effectsSoFar?: () => readonly string[];
  /** Whether the run can pause at the call asked about now: an approval then resumes it from that call. */
  canPause?: () => boolean;
  /** Whether the run replays a record: its script's approvals are then left to each live call, as it is made. */
  replaysRecord?: boolean;
}

const ALLOW: ReviewDecision = { decision: 'allow' };
/** Enclave's own limit on one review hook when `review.timeoutMs` is unset. */
const DEFAULT_REVIEW_TIMEOUT_MS = 30_000;
/** How many earlier tools a finding names, within the length Enclave accepts for a message. */
const MAX_NAMED_TOOLS = 10;
const REVIEW_ERROR_NAME = 'ReviewError';

function isCallRefusal(record: ReviewRecord): boolean {
  return record.phase === 'call' && (record.decision === 'denied' || record.decision === 'needs_changes');
}

/** The message Enclave throws into the script for a refused call (its `refusalMessage`), to tell which one it ended with. */
function refusalMessageOf(record: ReviewRecord): string {
  const subject = `the call to ${record.toolName ?? ''}`;
  if (record.decision === 'needs_changes') {
    const findings = (record.findings ?? [])
      .map((finding) => (finding.suggestion ? `${finding.message} (${finding.suggestion})` : finding.message))
      .join('; ');
    return `Review asks for changes to ${subject}: ${findings}`;
  }
  return `Review denied ${subject}: ${record.reason ?? ''}`;
}

/**
 * The call refusals a run ended with, uncaught, in call order: those whose message is the ReviewError's it threw, or
 * those a failed `parallel()` it threw listed. A refusal whose message the error does not carry whole is not one.
 */
export function refusalsEndedWith(
  decisions: readonly ReviewRecord[],
  runError?: { name?: string; message?: string },
): ReviewRecord[] {
  const refusals = decisions.filter(isCallRefusal);
  const listed = parallelFailuresOf(runError?.message);
  const ended =
    runError?.name === REVIEW_ERROR_NAME
      ? refusals.filter((record) => refusalMessageOf(record) === runError.message)
      : refusals.filter((record) => listed?.(refusalMessageOf(record)) === true);
  return ended.sort((left, right) => (left.callIndex ?? 0) - (right.callIndex ?? 0));
}

/**
 * The call refusal a run ended with, uncaught: the first it threw or a failed `parallel()` listed, else, for a
 * ReviewError whose message names none of them, the last refusal.
 */
function uncaughtRefusalOf(
  decisions: readonly ReviewRecord[],
  runError?: { name?: string; message?: string },
): ReviewRecord | undefined {
  const [first] = refusalsEndedWith(decisions, runError);
  if (first || runError?.name !== REVIEW_ERROR_NAME) return first;
  return decisions.filter(isCallRefusal).at(-1);
}

/**
 * How the review ended a run, from Enclave's record of its decisions: a failed review, a refused script, a call that
 * needs approval (which stops the run), or a refused call the script did not catch, alone or in a `parallel()`.
 * Undefined when the review let the run end on its own.
 */
export function reviewOutcomeOf(
  decisions: readonly ReviewRecord[],
  runError?: { name?: string; message?: string },
): CodeCallReviewOutcome | undefined {
  const failed = decisions.find((record) => record.decision === 'review_failed');
  if (failed) return { status: 'review_failed', reason: failed.reason, phase: failed.phase };
  const stopping = decisions.find(
    (record) => record.decision === 'needs_approval' || (record.phase === 'script' && record.decision !== 'allow'),
  );
  const refusal = stopping ?? uncaughtRefusalOf(decisions, runError);
  if (!refusal) return undefined;
  return {
    status: refusal.decision as CodeCallReviewStatus,
    ...(refusal.reason !== undefined && { reason: refusal.reason }),
    ...(refusal.findings && { findings: refusal.findings }),
    ...(refusal.callIndex !== undefined && { callIndex: refusal.callIndex }),
  };
}

/** The approval a `needs_approval` refers to, with the call it covers when a rule asked for it. */
export interface PendingApproval {
  reference: CodeCallApprovalReference;
  call?: ApprovalCall;
}

/** The review of one run: the built-in rules, then the server's reviewers, with the approvals people granted. */
export class RunReview {
  /** The approval the last `needs_approval` of this run refers to, with the call it covers. */
  pendingApproval?: PendingApproval;
  /** The approval each call that needs one waits for, by its place in the run: a `parallel()` may ask for several. */
  private readonly pendingByCallIndex = new Map<number | undefined, PendingApproval>();

  constructor(private readonly options: RunReviewOptions) {}

  /** How long one review hook may take, in ms. */
  get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;
  }

  /** The approvals this run's calls wait for. */
  get pendingApprovals(): Iterable<PendingApproval> {
    return this.pendingByCallIndex.values();
  }

  /** The approval the call at `callIndex` waits for (the script's, without one), else the last one asked for. */
  pendingApprovalAt(callIndex: number | undefined): PendingApproval | undefined {
    return this.pendingByCallIndex.get(callIndex) ?? this.pendingApproval;
  }

  /** Enclave's `review` option for the run. */
  get hooks(): ReviewOptions {
    const { timeoutMs } = this.options;
    return { pre: this.pre, ...(timeoutMs !== undefined && { timeoutMs }) };
  }

  readonly pre = async (input: PreReviewInput): Promise<ReviewDecision> => {
    const verdict = this.rulesVerdictOf(input);
    if (verdict?.refusal) return verdict.refusal;
    const asksApprovals = input.phase === 'call' || !this.options.replaysRecord;
    const callIndex = input.phase === 'call' ? input.callIndex : undefined;
    for (const call of asksApprovals ? (verdict?.approvalCalls ?? []) : []) {
      const needsApproval = await this.approvalOfCall(call, input.phase === 'call', callIndex);
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

  private approvalOfCall(
    call: ApprovalCall,
    consume: boolean,
    callIndex: number | undefined,
  ): Promise<ReviewDecision | undefined> {
    const reference = this.options.approvals.referenceFor(call);
    return this.approvalOf(
      { reference, call },
      consume,
      {
        decision: 'needs_approval',
        reason: `Tool "${call.toolName}" is destructive: it runs once a person approves this call`,
      },
      callIndex,
    );
  }

  /** Undefined when a person approved the reference; otherwise the decision that stops the run. */
  private async approvalOf(
    pending: PendingApproval,
    consume: boolean,
    request: Extract<ReviewDecision, { decision: 'needs_approval' }>,
    callIndex?: number,
  ): Promise<ReviewDecision | undefined> {
    const state = await this.options.approvals.stateOf(pending.reference, consume);
    if (state === 'approved') return undefined;
    if (state === 'denied') {
      return { ...request, decision: 'denied', reason: `${request.reason}; a person refused the approval` };
    }
    if (!this.options.hasApprovalChannel) {
      return { ...request, decision: 'denied', reason: `${request.reason}; ${NO_APPROVAL_CHANNEL}` };
    }
    const repeated = consume && pending.call ? (this.options.effectsSoFar?.() ?? []) : [];
    if (pending.call && repeated.length > 0 && !this.options.canPause?.()) {
      return needsOwnScript(pending.call.toolName, repeated);
    }
    this.pendingApproval = pending;
    this.pendingByCallIndex.set(callIndex, pending);
    return request;
  }
}

/**
 * The answer for a call that needs approval after tools with effects ran, in a run that cannot pause: approving it
 * would run the whole script, and those tools, again.
 */
export function needsOwnScript(toolName: string, repeated: readonly string[]): ReviewDecision {
  return { decision: 'needs_changes', findings: approvalAfterEffectsFindings(toolName, repeated) };
}

/** The finding {@link needsOwnScript} answers with, also for a run that stopped for an approval and could not pause. */
export function approvalAfterEffectsFindings(toolName: string, repeated: readonly string[]): ReviewFinding[] {
  const more = repeated.length - MAX_NAMED_TOOLS;
  const earlier = `${repeated.slice(0, MAX_NAMED_TOOLS).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return [
    {
      rule: 'approval-after-effects',
      message: `Tool "${toolName}" needs a person's approval, but ${earlier} already ran in this script; once approved, the whole script, ${earlier} included, would run again`,
      suggestion: `${earlier} already ran; send only ${toolName} and the calls after it, in a script of their own`,
      toolName,
    },
  ];
}
