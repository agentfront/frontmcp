import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID to retrieve'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    found: z.boolean(),
    entry: z
      .object({
        id: z.string(),
        userSub: z.string(),
        userEmail: z.string().optional(),
        userName: z.string().optional(),
        clientId: z.string(),
        createdAt: z.number(),
        lastAccessAt: z.number(),
        authorizedAppIds: z.array(z.string()),
        skippedAppIds: z.array(z.string()),
        pendingAuthCount: z.number(),
        credentialCount: z.number(),
      })
      .optional(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'get-vault-entry',
  description: 'Retrieve an authorization vault entry by ID',
  inputSchema,
  outputSchema,
})
export default class GetVaultEntryTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    const entry = await vault.get(input.entryId);

    if (!entry) {
      return {
        success: true,
        found: false,
        message: `Vault entry ${input.entryId} not found`,
      };
    }

    return {
      success: true,
      found: true,
      entry: {
        id: entry.id,
        userSub: entry.userSub,
        userEmail: entry.userEmail,
        userName: entry.userName,
        clientId: entry.clientId,
        createdAt: entry.createdAt,
        lastAccessAt: entry.lastAccessAt,
        authorizedAppIds: entry.authorizedAppIds,
        skippedAppIds: entry.skippedAppIds,
        pendingAuthCount: entry.pendingAuths.length,
        credentialCount: Object.keys(entry.appCredentials).length,
      },
      message: `Found vault entry ${entry.id}`,
    };
  }
}
