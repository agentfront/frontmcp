import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import type { JobExecutionManager } from '../execution/job-execution.manager';

@Tool({
  name: 'get-job-status',
  description: 'Get the execution status of a job or workflow run by runId.',
  inputSchema: {
    runId: z.string().describe('Run ID returned from execute-job or execute-workflow'),
  },
  outputSchema: {
    runId: z.string(),
    jobName: z.string(),
    state: z.string(),
    result: z.unknown().optional(),
    error: z
      .object({
        message: z.string(),
        name: z.string(),
      })
      .optional(),
    startedAt: z.number(),
    completedAt: z.number().optional(),
    attempt: z.number(),
    logs: z.array(z.string()),
  },
})
export default class GetJobStatusTool extends ToolContext {
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

    return {
      runId: record.runId,
      jobName: record.jobName,
      state: record.state,
      result: record.result,
      error: record.error,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      attempt: record.attempt,
      logs: record.logs,
    };
  }
}
