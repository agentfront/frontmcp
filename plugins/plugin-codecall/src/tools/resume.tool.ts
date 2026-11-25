import { getCallSurface, Tool, type ToolEntry } from '@frontmcp/sdk';
import { sha256Hex } from '@frontmcp/utils';

import CodeCallConfig from '../providers/code-call.config';
import { createRunReview, reviewContextOf } from '../review/create-run-review';
import { ApprovalServiceViewToken } from '../review/review-approvals';
import { invocationScriptOf, reviewInvocation } from '../review/review-invocation';
import type { CodeCallReviewResult } from '../review/review-result';
import CodeCallReviewService from '../review/review.service';
import type { CodeCallPausedRunRecord } from '../runs/run-record.store';
import { CodeCallRunStoreToken } from '../runs/run-record.types';
import { checkCodeCallToolAccess, isBlockedSelfReference } from '../security';
import { toolsWithheldByAuthorities } from '../security/codecall-discovery-authorities';
import { executeToolOutputSchema, type CodeCallExecuteResult } from './execute.schema';
import { CodeCallScriptTool } from './execute.tool';
import { claimPausedRun, readPausedRun, runNotFoundError } from './paused-runs';
import { resumeToolDescription, resumeToolInputSchema, type ResumeToolInput } from './runs.schema';

/**
 * Resumes a paused run, once: it runs the run's script again, answers the calls before the paused one from the run's
 * journal, and runs the paused call live, with the agent's corrected arguments when it sent them. The caller must own
 * the run and may still call every tool whose result it replays; the run's own checks and review apply to the rest.
 */
@Tool({
  name: 'codecall:resume',
  cache: { ttl: 0, slideWindow: false },
  codecall: { enabledInCodeCall: false, visibleInListTools: true },
  description: resumeToolDescription,
  inputSchema: resumeToolInputSchema,
  outputSchema: executeToolOutputSchema,
})
export default class ResumeTool extends CodeCallScriptTool {
  async execute({ runId, arguments: correctedArguments }: ResumeToolInput): Promise<CodeCallExecuteResult> {
    const runs = this.tryGet(CodeCallRunStoreToken);
    if (!runs?.keepsResultsOf(this)) throw runNotFoundError(runId);
    const run = await readPausedRun(runs, runId, this);
    const refusedTool = await this.toolNoLongerAllowed(run);
    if (refusedTool) {
      return {
        status: 'denied',
        reason: `Tool "${refusedTool}", whose result the run would replay, is no longer allowed for this caller; the run was not resumed`,
        runId,
      };
    }
    const correctionRefused = correctedArguments && (await this.reviewCorrection(run, correctedArguments));
    if (correctionRefused) return { ...correctionRefused, runId };
    await claimPausedRun(runs, run, this, this.get(CodeCallConfig).getAll().resolvedVm.timeoutMs);
    this.scriptRunId = runId;
    const { pause, journal, clock, random, startedAt } = run;
    return this.runAndKeep(
      { script: pause.script, allowedTools: pause.allowedTools },
      { startedAt, source: { journal, clock, random, pending: { call: pause.call, arguments: correctedArguments } } },
    );
  }

  /**
   * The server's reviewers' answer to the corrected call, as the one-call script `codecall:invoke` would send: they judge
   * scripts, and the stored script does not hold these arguments. Undefined when they allow it, or none are configured.
   */
  private async reviewCorrection(
    run: CodeCallPausedRunRecord,
    correctedArguments: Record<string, unknown>,
  ): Promise<CodeCallReviewResult | undefined> {
    const service = this.tryGet(CodeCallReviewService);
    if (!service?.hasReviewers) return undefined;
    const code = invocationScriptOf(run.pause.call.tool, correctedArguments);
    const surface = getCallSurface();
    const review = await createRunReview(
      service,
      {
        scope: this.scope,
        config: this.get(CodeCallConfig),
        authInfo: this.authInfo,
        surface,
        directCall: true,
        approvalService: this.tryGet(ApprovalServiceViewToken),
        canElicit: false,
        granted: new Set(),
        reviewersOnly: true,
      },
      sha256Hex(code),
    );
    return reviewInvocation(review, code, reviewContextOf(this, surface));
  }

  /** A tool whose recorded result the run would replay that the caller may no longer call, as a live call would find. */
  private async toolNoLongerAllowed(run: CodeCallPausedRunRecord): Promise<string | undefined> {
    const withheld = await toolsWithheldByAuthorities(this.scope, this.authInfo);
    const allowedTools = run.pause.allowedTools && new Set(run.pause.allowedTools);
    const surface = getCallSurface();
    const replayedTools = run.journal
      .filter((entry) => entry.outcome === 'success' && !isBlockedSelfReference(entry.tool))
      .map((entry) => entry.tool);
    return [...new Set(replayedTools)].find((name) => {
      const access = checkCodeCallToolAccess<ToolEntry>(this.scope, this.get(CodeCallConfig), name, { surface });
      return !access.allowed || withheld.has(access.entry.fullName) || (allowedTools && !allowedTools.has(name));
    });
  }
}
