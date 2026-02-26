import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = {
  userId: z.string().describe('User ID for the activity'),
  type: z.enum(['call', 'email', 'meeting', 'note']).describe('Activity type'),
  description: z.string().describe('Activity description'),
};

const outputSchema = z.object({
  activity: z.object({
    id: z.string(),
    userId: z.string(),
    type: z.enum(['call', 'email', 'meeting', 'note']),
    description: z.string(),
    timestamp: z.string(),
  }),
});

@Tool({
  name: 'activities-log',
  description: 'Log a new activity for a user',
  inputSchema,
  outputSchema,
})
export default class ActivitiesLogTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const activity = crmStore.logActivity(input);
    return { activity };
  }
}
