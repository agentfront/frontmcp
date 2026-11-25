import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { crmStore } from '../data/crm.store';

const inputSchema = {
  id: z.string().describe('User ID to offboard'),
};

const outputSchema = z.object({
  offboarded: z.boolean(),
});

@Tool({
  name: 'users-offboard',
  description: 'Offboard a user: removes them from the CRM for good',
  inputSchema,
  outputSchema,
  annotations: { destructiveHint: true },
})
export default class UsersOffboardTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return { offboarded: crmStore.deleteUser(input.id) };
  }
}
