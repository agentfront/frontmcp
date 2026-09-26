import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {};
const outputSchema = z.object({ wiped: z.number() });

@Tool({
  name: 'system:wipe-config',
  description: 'Wipe the CRM configuration and data (in a namespace CodeCall never calls)',
  inputSchema,
  outputSchema,
})
export default class SystemWipeConfigTool extends ToolContext {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return { wiped: crmStore.purgeUsers() };
  }
}
