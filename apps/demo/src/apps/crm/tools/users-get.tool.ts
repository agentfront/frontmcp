import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'users:get',
  description: 'Get a specific user by ID or email address.',
  inputSchema: {
    id: z.string().optional().describe('The user ID (e.g., user_001)'),
    email: z.string().email().optional().describe('The user email address'),
  },
  outputSchema: {
    user: z
      .object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        role: z.enum(['admin', 'user', 'viewer']),
        status: z.enum(['active', 'inactive', 'pending']),
        createdAt: z.string(),
        lastLoginAt: z.string().optional(),
      })
      .nullable(),
    found: z.boolean(),
  },
})
export default class UsersGetTool extends ToolContext {
  async execute(input: { id?: string; email?: string }) {
    if (!input.id && !input.email) {
      throw new Error('Either id or email must be provided');
    }

    const user = input.id ? CrmStore.users.get(input.id) : CrmStore.users.getByEmail(input.email!);

    return {
      user: user || null,
      found: !!user,
    };
  }
}
