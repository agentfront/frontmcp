import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { CrmStore } from '../data/store';

@Tool({
  name: 'users:delete',
  description: 'Delete a user from the CRM system.',
  inputSchema: {
    id: z.string().describe('The user ID to delete'),
  },
  outputSchema: {
    success: z.boolean(),
    message: z.string(),
  },
})
export default class UsersDeleteTool extends ToolContext {
  async execute(input: { id: string }) {
    const existing = CrmStore.users.get(input.id);
    if (!existing) {
      throw new Error(`User ${input.id} not found`);
    }

    const deleted = CrmStore.users.delete(input.id);

    return {
      success: deleted,
      message: deleted ? `User ${input.id} deleted successfully` : `Failed to delete user ${input.id}`,
    };
  }
}
