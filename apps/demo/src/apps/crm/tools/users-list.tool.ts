import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore, User } from '../data/store';

@Tool({
  name: 'users:list',
  description: 'List all users in the CRM. Optionally filter by status or role.',
  inputSchema: {
    status: z.enum(['active', 'inactive', 'pending']).optional().describe('Filter by user status'),
    role: z.enum(['admin', 'user', 'viewer']).optional().describe('Filter by user role'),
  },
  outputSchema: {
    users: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        role: z.enum(['admin', 'user', 'viewer']),
        status: z.enum(['active', 'inactive', 'pending']),
        createdAt: z.string(),
        lastLoginAt: z.string().optional(),
      }),
    ),
    total: z.number(),
  },
})
export default class UsersListTool extends ToolContext {
  async execute(input: { status?: User['status']; role?: User['role'] }) {
    const users = CrmStore.users.list(input);
    return {
      users,
      total: users.length,
    };
  }
}
