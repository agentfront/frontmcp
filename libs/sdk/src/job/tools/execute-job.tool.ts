import { internalZ as z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { JobNotAuthorizedError } from '../../errors';
import type { JobExecutionManager } from '../execution/job-execution.manager';
import { jobRunUri } from '../job-run-access';

@Tool({
  name: 'execute_job',
  description:
    'Execute a registered job by name. Supports inline (synchronous) and background execution; a background run ' +
    'answers at once with its runId and the job://runs/{runId} resource to read or subscribe to.',
  inputSchema: {
    name: z.string().describe('Job name to execute'),
    input: z.record(z.string(), z.unknown()).optional().describe('Job input data'),
    background: z.boolean().optional().default(false).describe('Run in background (returns runId for status polling)'),
  },
  outputSchema: {
    runId: z.string(),
    state: z.string(),
    uri: z.string().describe('The job://runs/{runId} resource of the run'),
    result: z.unknown().optional(),
    logs: z.array(z.string()).optional(),
  },
})
export default class ExecuteJobTool extends ToolContext {
  async execute(input: { name: string; input?: Record<string, unknown>; background: boolean }) {
    const scope = this.scope as unknown as { _jobExecutionManager?: JobExecutionManager };
    const executionManager = scope._jobExecutionManager;
    const jobRegistry = this.scope.jobs;

    if (!executionManager || !jobRegistry) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    const job = jobRegistry.findByName(input.name);
    if (!job) {
      // Same error as "not permitted" below, so a caller cannot tell restricted
      // jobs from non-existent ones (GHSA-58v2-gpcc-jmqv).
      return this.fail(new JobNotAuthorizedError(input.name));
    }

    // Permissions are enforced inside executeJob — the single choke point every
    // caller path funnels through — which throws JobNotAuthorizedError.
    const result = await executionManager.executeJob(job, input.input ?? {}, {
      background: input.background,
      sessionId: this.authInfo.sessionId,
      authInfo: this.authInfo,
      context: this.context,
      authoritiesContextBuilder: this.scope.authoritiesContextBuilder,
    });

    return { ...result, uri: jobRunUri(result.runId) };
  }
}
