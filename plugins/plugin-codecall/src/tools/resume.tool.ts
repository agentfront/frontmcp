import { getCallSurface, Tool, type ToolEntry } from '@frontmcp/sdk';

import CodeCallConfig from '../providers/code-call.config';
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
    await claimPausedRun(runs, run, this);
    this.scriptRunId = runId;
    const { pause, journal, clock, random, startedAt } = run;
    return this.runAndKeep(
      { script: pause.script, allowedTools: pause.allowedTools },
      { startedAt, source: { journal, clock, random, pending: { call: pause.call, arguments: correctedArguments } } },
    );
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
