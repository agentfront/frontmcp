import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { executionTracker } from '../data/execution-tracker';

const outputSchema = z.object({
  executionCounts: z.record(z.string(), z.number()),
  totalExecutions: z.number(),
  trackedTools: z.number(),
});

@Resource({
  uri: 'cache://stats',
  name: 'Cache Statistics',
  description: 'Current cache execution statistics',
  mimeType: 'application/json',
})
export default class CacheStatsResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    const counts = executionTracker.getAll();
    const totalExecutions = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      executionCounts: counts,
      totalExecutions,
      trackedTools: Object.keys(counts).length,
    };
  }
}
