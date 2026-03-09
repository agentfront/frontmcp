import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = {};

const outputSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      company: z.string(),
      role: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number(),
});

@Tool({
  name: 'users-list',
  description: 'List all users in the CRM system',
  inputSchema,
  outputSchema,
})
export default class UsersListTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const users = crmStore.listUsers();
    return { users, count: users.length };
  }
}
