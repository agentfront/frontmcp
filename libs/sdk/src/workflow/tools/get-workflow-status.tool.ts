import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { resolvePrincipal } from '../../common/utils/principal.utils';
import type { JobExecutionManager } from '../../job/execution/job-execution.manager';
import type { WorkflowRunRecord } from '../../job/store/job-state.interface';

@Tool({
  name: 'get_workflow_status',
  description: 'Get the execution status of a workflow run with per-step results.',
  inputSchema: {
    runId: z.string().describe('Run ID returned from execute_workflow'),
  },
  outputSchema: {
    runId: z.string(),
    workflowName: z.string().optional(),
    state: z.string(),
    stepResults: z
      .record(
        z.string(),
        z.object({
          state: z.string(),
          outputs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
  },
})
export default class GetWorkflowStatusTool extends ToolContext {
  async execute(input: { runId: string }) {
    const scope = this.scope as unknown as { _jobExecutionManager?: JobExecutionManager };
    const executionManager = scope._jobExecutionManager;

    if (!executionManager) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    const record = await executionManager.getStatus(input.runId);
    // Scoped to the caller who started the run — step results carry the
    // workflow's inputs and outputs (GHSA-58v2-gpcc-jmqv).
    if (!record || !this.ownsRun(record)) {
      return this.fail(new Error(`Run "${input.runId}" not found`));
    }

    const workflowRecord = record as WorkflowRunRecord;
    return {
      runId: record.runId,
      workflowName: workflowRecord.workflowName,
      state: record.state,
      stepResults: workflowRecord.stepResults,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
    };
  }

  /**
   * Match on the owning subject, falling back to the session for runs started
   * before an owner was recorded (and for anonymous/public servers, where every
   * caller has an empty subject and the session is the only identity there is).
   *
   * A record carrying NEITHER identity is refused. Such a run cannot be
   * attributed to anyone, and its inputs and results are exactly what this check
   * exists to protect — anyone holding the id would otherwise be able to read
   * it. Internal callers that must read unattributed runs should go through the
   * execution manager directly rather than this tool.
   */
  private ownsRun(record: { ownerSub?: string; sessionId?: string }): boolean {
    const callerSub = resolvePrincipal(this.authInfo, this.scope.authoritiesContextBuilder).sub;
    if (record.ownerSub) return record.ownerSub === callerSub;
    if (record.sessionId) return record.sessionId === this.authInfo.sessionId;
    return false;
  }
}
