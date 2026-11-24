import type { ReviewContext, ScriptAnalysis } from '@enclave-vm/core/worker';

import { canonicalJson } from '@frontmcp/utils';

import { loadWorkerEntry } from '../services/runtime/interpreter.runtime';
import { reviewResultOf, type CodeCallReviewResult } from './review-result';
import type { RunReview } from './run-review';

type ScriptAnalyzer = (code: string) => ScriptAnalysis;

const loadAnalyzer = async (): Promise<ScriptAnalyzer> => (await loadWorkerEntry())['analyzeScript'] as ScriptAnalyzer;

/** The one-call script a `codecall:invoke` stands for: what the server's reviewers read, and what approvals cover. */
export function invocationScriptOf(toolName: string, input: unknown): string {
  return `return await callTool(${JSON.stringify(toolName)}, ${canonicalJson(input ?? {})});`;
}

/** A review that took longer than `review.timeoutMs`, as Enclave fails a hook that does. */
class ReviewTimeoutError extends Error {}

function failureReasonOf(error: unknown): string {
  if (error instanceof ReviewTimeoutError) return error.message;
  return error instanceof Error && error.name === 'ReviewerError' ? error.message : 'The review hook threw';
}

/**
 * The review of a `codecall:invoke`, as of the one-call script it stands for: undefined when it may run, otherwise
 * the result that refuses it. A reviewer that fails, or takes longer than `review.timeoutMs`, refuses it with
 * `review_failed`, as it would a script.
 */
export async function reviewInvocation(
  review: RunReview,
  code: string,
  context: ReviewContext,
  analyze: () => Promise<ScriptAnalyzer> = loadAnalyzer,
): Promise<CodeCallReviewResult | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new ReviewTimeoutError(`The review hook did not answer within ${review.timeoutMs} ms`)),
      review.timeoutMs,
    );
  });
  try {
    const analysis = (await analyze())(code);
    const decision = await Promise.race([review.pre({ phase: 'script', code, analysis, context }), timedOut]);
    if (decision.decision === 'allow') return undefined;
    const { decision: status, findings } = decision;
    const reason = 'reason' in decision ? decision.reason : undefined;
    return reviewResultOf({ status, reason, findings }, review.pendingApproval);
  } catch (error: unknown) {
    return reviewResultOf({ status: 'review_failed', reason: failureReasonOf(error) });
  } finally {
    clearTimeout(timer);
  }
}
