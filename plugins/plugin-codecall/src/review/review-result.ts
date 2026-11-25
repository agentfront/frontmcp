import type {
  CodeCallDeniedResult,
  CodeCallExecuteResult,
  CodeCallNeedsApprovalResult,
  CodeCallNeedsChangesResult,
  CodeCallReviewFailedResult,
} from '../tools/execute.schema';
import { approvalAfterEffectsFindings, type CodeCallReviewOutcome, type PendingApproval } from './run-review';

/** A `codecall:execute` result the review gave. */
export type CodeCallReviewResult =
  | CodeCallNeedsChangesResult
  | CodeCallNeedsApprovalResult
  | CodeCallDeniedResult
  | CodeCallReviewFailedResult;

const REVIEW_STATUSES: ReadonlySet<string> = new Set(['needs_changes', 'needs_approval', 'denied', 'review_failed']);

/** What a failed review leaves behind: nothing before the script ran, the calls before it after a call. */
function whatRanBefore(outcome: CodeCallReviewOutcome): string {
  if (outcome.phase === undefined || outcome.phase === 'script') {
    return 'Nothing ran, so the same script can be sent again.';
  }
  return 'The calls before it ran, and their effects are not rolled back.';
}

/** The result for how the review ended a run. */
export function reviewResultOf(outcome: CodeCallReviewOutcome, pending?: PendingApproval): CodeCallReviewResult {
  const findings = outcome.findings ?? [];
  const reason = outcome.reason ?? '';
  switch (outcome.status) {
    case 'review_failed':
      return { status: 'review_failed', error: { message: `Review failed: ${reason}. ${whatRanBefore(outcome)}` } };
    case 'needs_changes':
      return { status: 'needs_changes', findings };
    case 'needs_approval':
      return {
        status: 'needs_approval',
        reason,
        ...(pending && { approval: pending.reference }),
        ...(findings.length > 0 && { findings }),
      };
    case 'denied':
      return { status: 'denied', reason, ...(findings.length > 0 && { findings }) };
  }
}

/**
 * A run's result once it is known whether it was kept paused: a `needs_approval` after calls with effects, in a run
 * that was not, asks for the call in a script of its own, since approving it would run those calls again.
 */
export function unpausedResultOf(result: CodeCallExecuteResult, pending?: PendingApproval): CodeCallExecuteResult {
  if (result.status !== 'needs_approval' || !pending?.call || !pending.effectsBefore?.length) return result;
  return {
    status: 'needs_changes',
    findings: approvalAfterEffectsFindings(pending.call.toolName, pending.effectsBefore),
  };
}

/** The run record's `reviewDecision` for a reviewed run: its review status, or `allow`. */
export function reviewDecisionOf(result: CodeCallExecuteResult): string {
  return REVIEW_STATUSES.has(result.status) ? result.status : 'allow';
}
