import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {};
const outputSchema = z.object({ emails: z.array(z.string()) });

@Tool({
  name: 'users-export',
  description: 'Export every user email address (opted out of CodeCall)',
  inputSchema,
  outputSchema,
  codecall: { enabledInCodeCall: false },
})
export default class UsersExportTool extends ToolContext {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return { emails: crmStore.listUsers().map((user) => user.email) };
  }
}
