import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import type { JobRegistryInterface } from '../job.registry';

@Tool({
  name: 'remove-job',
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
      return this.fail(new Error(`Job "${input.name}" not found`));
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
