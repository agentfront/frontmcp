import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = z
  .object({
    id: z.string().describe('User ID'),
  })
  .strict();

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
});

@Tool({
  name: 'users-get',
  description: 'Get a specific user by ID',
  inputSchema,
  outputSchema,
})
export default class UsersGetTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const user = crmStore.getUser(input.id);
    return { user: user || null };
  }
}
