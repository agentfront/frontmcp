import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import type { JobRegistryInterface } from '../job.registry';
import type { JobExecutionManager } from '../execution/job-execution.manager';

@Tool({
  name: 'execute-job',
  description: 'Execute a registered job by name. Supports inline (synchronous) and background execution.',
  inputSchema: {
    name: z.string().describe('Job name to execute'),
    input: z.record(z.string(), z.unknown()).optional().describe('Job input data'),
    background: z.boolean().optional().default(false).describe('Run in background (returns runId for status polling)'),
  },
  outputSchema: {
    runId: z.string(),
    state: z.string(),
    result: z.unknown().optional(),
    logs: z.array(z.string()).optional(),
  },
})
export default class ExecuteJobTool extends ToolContext {
  async execute(input: { name: string; input?: Record<string, unknown>; background: boolean }) {
    const scope = this.scope as unknown as { jobs?: JobRegistryInterface; _jobExecutionManager?: JobExecutionManager };
    const executionManager = scope._jobExecutionManager;
    const jobRegistry = scope.jobs;

    if (!executionManager || !jobRegistry) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    const job = jobRegistry.findByName(input.name);
    if (!job) {
      return this.fail(new Error(`Job "${input.name}" not found`));
    }

    const result = await executionManager.executeJob(job, input.input ?? {}, {
      background: input.background,
      sessionId: this.authInfo.sessionId,
      authInfo: this.authInfo,
    });

    return result;
  }
}
