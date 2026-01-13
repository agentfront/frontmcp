import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = z
  .object({
    userSub: z.string().describe('User subject identifier'),
    userEmail: z.string().email().optional().describe('User email'),
    userName: z.string().optional().describe('User display name'),
    clientId: z.string().describe('Client identifier'),
  })
  .strict();

const outputSchema = z
  .object({
    success: z.boolean(),
    entryId: z.string(),
    userSub: z.string(),
    clientId: z.string(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'create-vault-entry',
  description: 'Create a new authorization vault entry for a user/client',
  inputSchema,
  outputSchema,
})
export default class CreateVaultEntryTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      const entry = await vault.create({
        userSub: input.userSub,
        userEmail: input.userEmail,
        userName: input.userName,
        clientId: input.clientId,
      });

      return {
        success: true,
        entryId: entry.id,
        userSub: entry.userSub,
        clientId: entry.clientId,
        message: `Created vault entry ${entry.id} for user ${input.userSub}`,
      };
    } catch (error) {
      return {
        success: false,
        entryId: '',
        userSub: input.userSub,
        clientId: input.clientId,
        message: `Failed to create vault entry: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
