import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'activities:stats',
  description: 'Get activity statistics, optionally filtered by user.',
  inputSchema: {
    userId: z.string().optional().describe('Filter stats by user ID'),
  },
  outputSchema: {
    stats: z.object({
      total: z.number(),
      byType: z.record(z.string(), z.number()),
    }),
  },
})
export default class ActivitiesStatsTool extends ToolContext {
  async execute(input: { userId?: string }) {
    const stats = CrmStore.activities.getStats(input.userId);

    return {
      stats,
    };
  }
}
