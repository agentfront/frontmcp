import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'users:create',
  description: 'Create a new user in the CRM system.',
  inputSchema: {
    email: z.string().email().describe('The user email address'),
    name: z.string().min(1).describe('The user full name'),
    role: z.enum(['admin', 'user', 'viewer']).optional().describe('The user role (default: user)'),
    status: z.enum(['active', 'inactive', 'pending']).optional().describe('The user status (default: pending)'),
  },
  outputSchema: {
    user: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.enum(['admin', 'user', 'viewer']),
      status: z.enum(['active', 'inactive', 'pending']),
      createdAt: z.string(),
      lastLoginAt: z.string().optional(),
    }),
    success: z.boolean(),
  },
})
export default class UsersCreateTool extends ToolContext {
  async execute(input: {
    email: string;
    name: string;
    role?: 'admin' | 'user' | 'viewer';
    status?: 'active' | 'inactive' | 'pending';
  }) {
    // Check if email already exists
    const existing = CrmStore.users.getByEmail(input.email);
    if (existing) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    const user = CrmStore.users.create({
      email: input.email,
      name: input.name,
      role: input.role || 'user',
      status: input.status || 'pending',
    });

    return {
      user,
      success: true,
    };
  }
}
