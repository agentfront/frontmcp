import { z } from 'zod';
import { Tool, ToolContext } from '../../common';
import { JobEntry } from '../../common/entries/job.entry';
import type { JobRegistryInterface } from '../job.registry';

@Tool({
  name: 'list-jobs',
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
      }),
    ),
  },
  hideFromDiscovery: true,
})
export default class ListJobsTool extends ToolContext {
  async execute(input: { tags?: string[]; labels?: Record<string, string>; query?: string }) {
    const jobRegistry = (this.scope as unknown as { jobs?: JobRegistryInterface }).jobs;
    if (!jobRegistry) {
      return { jobs: [] };
    }

    const jobs = jobRegistry.search(input.query, {
      tags: input.tags,
      labels: input.labels,
    });

    return {
      jobs: jobs.map((j: JobEntry) => ({
        name: j.name,
        description: j.metadata.description,
        tags: j.getTags(),
        labels: j.getLabels(),
      })),
    };
  }
}
