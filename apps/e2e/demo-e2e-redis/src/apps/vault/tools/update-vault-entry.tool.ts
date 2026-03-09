import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID to update'),
  userEmail: z.string().email().optional().describe('New user email'),
  userName: z.string().optional().describe('New user display name'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'update-vault-entry',
  description: 'Update an authorization vault entry',
  inputSchema,
  outputSchema,
})
export default class UpdateVaultEntryTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      const updates: Record<string, unknown> = {};
      if (input.userEmail !== undefined) {
        updates.userEmail = input.userEmail;
      }
      if (input.userName !== undefined) {
        updates.userName = input.userName;
      }

      if (Object.keys(updates).length === 0) {
        return {
          success: false,
          message: 'No fields to update. Provide at least userEmail or userName.',
        };
      }

      await vault.update(input.entryId, updates);

      return {
        success: true,
        message: `Updated vault entry ${input.entryId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update vault entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
