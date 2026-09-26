import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {};
const outputSchema = z.object({ purged: z.number() });

@Tool({
  name: 'admin:purge-users',
  description: 'Delete every user in the CRM (withheld from CodeCall by the includeTools filter)',
  inputSchema,
  outputSchema,
})
export default class AdminPurgeUsersTool extends ToolContext {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return { purged: crmStore.purgeUsers() };
  }
}
