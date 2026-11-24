import type {
  CodeCallDeniedResult,
  CodeCallExecuteResult,
  CodeCallNeedsApprovalResult,
  CodeCallNeedsChangesResult,
  CodeCallReviewFailedResult,
} from '../tools/execute.schema';
import type { CodeCallReviewOutcome, PendingApproval } from './run-review';

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

/** The run record's `reviewDecision` for a reviewed run: its review status, or `allow`. */
export function reviewDecisionOf(result: CodeCallExecuteResult): string {
  return REVIEW_STATUSES.has(result.status) ? result.status : 'allow';
}
