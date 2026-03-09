import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = {
  id: z.string().describe('User ID'),
  name: z.string().optional().describe('User name'),
  email: z.string().email().optional().describe('User email'),
  company: z.string().optional().describe('Company name'),
  role: z.string().optional().describe('User role'),
};

const outputSchema = z.object({
  user: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      company: z.string(),
      role: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
  success: z.boolean(),
});

@Tool({
  name: 'users-update',
  description: 'Update an existing user',
  inputSchema,
  outputSchema,
})
export default class UsersUpdateTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const { id, ...updates } = input;
    const user = crmStore.updateUser(id, updates);
    return { user: user || null, success: !!user };
  }
}
