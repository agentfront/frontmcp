import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = z
  .object({
    entryId: z.string().describe('Vault entry ID to delete'),
  })
  .strict();

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'delete-vault-entry',
  description: 'Delete an authorization vault entry',
  inputSchema,
  outputSchema,
})
export default class DeleteVaultEntryTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      await vault.delete(input.entryId);

      return {
        success: true,
        message: `Deleted vault entry ${input.entryId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete vault entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
