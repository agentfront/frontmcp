import { z } from '@frontmcp/lazy-zod';

import { Tool, ToolContext } from '../../common';
import { type JobEntry } from '../../common/entries/job.entry';
import { JobPermissionGuard } from '../job-permission.guard';
import type { JobRegistryInterface } from '../job.registry';

@Tool({
  name: 'list_jobs',
  description: 'List registered jobs with optional filtering by tags or labels.',
  inputSchema: {
    tags: z.array(z.string()).optional().describe('Filter by tags'),
    labels: z.record(z.string(), z.string()).optional().describe('Filter by labels'),
    query: z.string().optional().describe('Search query for name/description'),
  },
  outputSchema: {
    jobs: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        labels: z.record(z.string(), z.string()).optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
    count: z.number(),
  },
  hideFromDiscovery: true,
})
export default class ListJobsTool extends ToolContext {
  async execute(input: { tags?: string[]; labels?: Record<string, string>; query?: string }) {
    const jobRegistry = (this.scope as unknown as { jobs?: JobRegistryInterface }).jobs;
    if (!jobRegistry) {
      return { jobs: [], count: 0 };
    }

    const jobs = jobRegistry.search(input.query, {
      tags: input.tags,
      labels: input.labels,
    });

    // Listing a job the caller may neither read nor execute leaks its name,
    // description and input schema. Filter to what this caller could actually
    // use (GHSA-58v2-gpcc-jmqv).
    const visible: JobEntry[] = [];
    for (const job of jobs as JobEntry[]) {
      if (await this.maySee(job)) visible.push(job);
    }

    const mapped = visible.map((j: JobEntry) => ({
      name: j.name,
      description: j.metadata.description,
      tags: j.getTags(),
      labels: j.getLabels(),
      inputSchema: j.getInputJsonSchema() ?? undefined,
    }));

    return {
      jobs: mapped,
      count: mapped.length,
    };
  }

  /**
   * A job is listable when the caller passes its `list` rules and is not
   * blocked from executing it. Checking `execute` too keeps the listing honest:
   * showing a job the caller can never run is the disclosure this closes.
   */
  private async maySee(job: JobEntry): Promise<boolean> {
    const permissions = job.metadata.permissions;
    const builder = this.scope.authoritiesContextBuilder;
    if (!(await JobPermissionGuard.check(permissions, 'list', this.authInfo, builder))) return false;
    return JobPermissionGuard.check(permissions, 'execute', this.authInfo, builder);
  }
}
