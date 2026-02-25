import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = {
  name: z.string().describe('User name'),
  email: z.string().email().describe('User email'),
  company: z.string().describe('Company name'),
  role: z.string().describe('User role'),
};

const outputSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    company: z.string(),
    role: z.string(),
    createdAt: z.string(),
  }),
});

@Tool({
  name: 'users-create',
  description: 'Create a new user in the CRM',
  inputSchema,
  outputSchema,
})
export default class UsersCreateTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const user = crmStore.createUser(input);
    return { user };
  }
}
