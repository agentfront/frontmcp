import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = z
  .object({
    userId: z.string().optional().describe('Filter by user ID'),
  })
  .strict();

const outputSchema = z.object({
  activities: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      type: z.enum(['call', 'email', 'meeting', 'note']),
      description: z.string(),
      timestamp: z.string(),
    }),
  ),
  count: z.number(),
});

@Tool({
  name: 'activities-list',
  description: 'List activities, optionally filtered by user',
  inputSchema,
  outputSchema,
})
export default class ActivitiesListTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const activities = crmStore.listActivities(input.userId);
    return { activities, count: activities.length };
  }
}
