import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore, Activity } from '../data/store';

@Tool({
  name: 'activities:list',
  description: 'List activities in the CRM. Can filter by user ID and activity type.',
  inputSchema: {
    userId: z.string().optional().describe('Filter by user ID'),
    type: z.enum(['login', 'logout', 'page_view', 'action', 'error']).optional().describe('Filter by activity type'),
    limit: z.number().min(1).max(100).optional().describe('Maximum number of activities to return (default: 20)'),
  },
  outputSchema: {
    activities: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        type: z.enum(['login', 'logout', 'page_view', 'action', 'error']),
        description: z.string(),
        metadata: z.record(z.unknown()).optional(),
        timestamp: z.string(),
      }),
    ),
    total: z.number(),
  },
})
export default class ActivitiesListTool extends ToolContext {
  async execute(input: { userId?: string; type?: Activity['type']; limit?: number }) {
    const activities = CrmStore.activities.list({
      userId: input.userId,
      type: input.type,
      limit: input.limit || 20,
    });

    return {
      activities,
      total: activities.length,
    };
  }
}
