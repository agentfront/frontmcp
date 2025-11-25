import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'activities:log',
  description: 'Log a new activity for a user in the CRM.',
  inputSchema: {
    userId: z.string().describe('The user ID who performed the activity'),
    type: z.enum(['login', 'logout', 'page_view', 'action', 'error']).describe('The type of activity'),
    description: z.string().describe('Description of the activity'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata about the activity'),
  },
  outputSchema: {
    activity: z.object({
      id: z.string(),
      userId: z.string(),
      type: z.enum(['login', 'logout', 'page_view', 'action', 'error']),
      description: z.string(),
      metadata: z.record(z.unknown()).optional(),
      timestamp: z.string(),
    }),
    success: z.boolean(),
  },
})
export default class ActivitiesLogTool extends ToolContext {
  async execute(input: {
    userId: string;
    type: 'login' | 'logout' | 'page_view' | 'action' | 'error';
    description: string;
    metadata?: Record<string, unknown>;
  }) {
    // Verify user exists
    const user = CrmStore.users.get(input.userId);
    if (!user) {
      throw new Error(`User ${input.userId} not found`);
    }

    const activity = CrmStore.activities.create({
      userId: input.userId,
      type: input.type,
      description: input.description,
      metadata: input.metadata,
    });

    // If it's a login, update the user's lastLoginAt
    if (input.type === 'login') {
      CrmStore.users.update(input.userId, { lastLoginAt: activity.timestamp });
    }

    return {
      activity,
      success: true,
    };
  }
}
