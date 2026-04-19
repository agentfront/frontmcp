import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {};

const outputSchema = z.object({
  total: z.number(),
  byType: z.record(z.string(), z.number()),
  byUser: z.record(z.string(), z.number()),
});

@Tool({
  name: 'activities-stats',
  description: 'Get activity statistics',
  inputSchema,
  outputSchema,
})
export default class ActivitiesStatsTool extends ToolContext {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return crmStore.getActivityStats();
  }
}
