import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import type { JobExecutionManager } from '../../job/execution/job-execution.manager';
import type { WorkflowRunRecord } from '../../job/store/job-state.interface';

@Tool({
  name: 'get-workflow-status',
  description: 'Get the execution status of a workflow run with per-step results.',
  inputSchema: {
    runId: z.string().describe('Run ID returned from execute-workflow'),
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
    if (!record) {
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
}
