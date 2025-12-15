import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const inputSchema = z
  .object({
    id: z.string().describe('User ID to delete'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

@Tool({
  name: 'users-delete',
  description: 'Delete a user from the CRM',
  inputSchema,
  outputSchema,
})
export default class UsersDeleteTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const deleted = crmStore.deleteUser(input.id);
    return {
      success: deleted,
      message: deleted ? `User ${input.id} deleted` : `User ${input.id} not found`,
    };
  }
}
