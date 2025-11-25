import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'users:update',
  description: 'Update an existing user in the CRM system.',
  inputSchema: {
    id: z.string().describe('The user ID to update'),
    email: z.string().email().optional().describe('New email address'),
    name: z.string().min(1).optional().describe('New full name'),
    role: z.enum(['admin', 'user', 'viewer']).optional().describe('New role'),
    status: z.enum(['active', 'inactive', 'pending']).optional().describe('New status'),
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
    success: z.boolean(),
  },
})
export default class UsersUpdateTool extends ToolContext {
  async execute(input: {
    id: string;
    email?: string;
    name?: string;
    role?: 'admin' | 'user' | 'viewer';
    status?: 'active' | 'inactive' | 'pending';
  }) {
    const { id, ...updates } = input;

    // Check if user exists
    const existing = CrmStore.users.get(id);
    if (!existing) {
      throw new Error(`User ${id} not found`);
    }

    // If email is being changed, check it's not taken
    if (updates.email && updates.email !== existing.email) {
      const emailTaken = CrmStore.users.getByEmail(updates.email);
      if (emailTaken) {
        throw new Error(`Email ${updates.email} is already in use`);
      }
    }

    const user = CrmStore.users.update(id, updates);

    return {
      user: user || null,
      success: !!user,
    };
  }
}
