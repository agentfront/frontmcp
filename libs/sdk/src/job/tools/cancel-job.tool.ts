import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { GenericServerError, JobRunNotFoundError } from '../../errors';
import { jobExecutionManagerOf, mayAccessRun } from '../job-run-access';

@Tool({
  name: 'cancel_job',
  description:
    'Cancel a job run by runId. The cancel is kept in the job store, so the process running it stops it, and its cleanup runs.',
  inputSchema: {
    runId: z.string().describe('Run ID returned from execute_job'),
  },
  outputSchema: {
    runId: z.string(),
    state: z.literal('cancelled'),
  },
})
export default class CancelJobTool extends ToolContext {
  async execute(input: { runId: string }) {
    const executionManager = jobExecutionManagerOf(this.scope);
    if (!executionManager) {
      return this.fail(new GenericServerError('Jobs system is not enabled'));
    }

    // A run the caller may not cancel reads like an unknown one (GHSA-58v2-gpcc-jmqv)
    const record = await executionManager.getStatus(input.runId);
    if (!record || !(await mayAccessRun(this.scope, record, 'delete', this.authInfo))) {
      return this.fail(new JobRunNotFoundError(input.runId));
    }

    await executionManager.cancel(input.runId);
    return { runId: input.runId, state: 'cancelled' as const };
  }
}
