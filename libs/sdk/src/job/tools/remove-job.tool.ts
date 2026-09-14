import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { JobNotAuthorizedError } from '../../errors';
import { JobPermissionGuard } from '../job-permission.guard';
import type { JobRegistryInterface } from '../job.registry';

@Tool({
  name: 'remove_job',
  description: 'Remove a dynamic job by name.',
  inputSchema: {
    name: z.string().describe('Job name to remove'),
  },
  outputSchema: {
    success: z.boolean(),
    message: z.string(),
  },
  hideFromDiscovery: true,
})
export default class RemoveJobTool extends ToolContext {
  async execute(input: { name: string }) {
    const scope = this.scope as unknown as { jobs?: JobRegistryInterface };
    const jobRegistry = scope.jobs;

    if (!jobRegistry) {
      return this.fail(new Error('Jobs system is not enabled'));
    }

    const job = jobRegistry.findByName(input.name);
    if (!job) {
      return this.fail(new JobNotAuthorizedError(input.name));
    }

    const allowed = await JobPermissionGuard.check(
      job.metadata.permissions,
      'delete',
      this.authInfo,
      this.scope.authoritiesContextBuilder,
    );
    if (!allowed) {
      // Indistinguishable from "not found", so removal cannot be used to probe
      // which restricted jobs exist (GHSA-58v2-gpcc-jmqv).
      return this.fail(new JobNotAuthorizedError(input.name));
    }

    if (!job.isDynamic()) {
      return this.fail(new Error(`Job "${input.name}" is not a dynamic job and cannot be removed`));
    }

    const removed = jobRegistry.removeDynamic(input.name);
    return {
      success: removed,
      message: removed ? `Job "${input.name}" removed` : `Failed to remove job "${input.name}"`,
    };
  }
}
