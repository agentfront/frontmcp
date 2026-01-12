import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = z
  .object({
    entryId: z.string().describe('Vault entry ID'),
    appId: z.string().describe('Application ID requiring auth'),
    toolId: z.string().optional().describe('Tool ID that triggered the auth'),
    authUrl: z.string().describe('URL for the user to complete auth'),
    requiredScopes: z.array(z.string()).optional().describe('Required scopes'),
    ttlMs: z.number().optional().describe('Time to live in milliseconds'),
  })
  .strict();

const outputSchema = z
  .object({
    success: z.boolean(),
    pendingAuthId: z.string().optional(),
    expiresAt: z.number().optional(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'create-pending-auth',
  description: 'Create a pending incremental auth request',
  inputSchema,
  outputSchema,
})
export default class CreatePendingAuthTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      const pendingAuth = await vault.createPendingAuth(input.entryId, {
        appId: input.appId,
        toolId: input.toolId,
        authUrl: input.authUrl,
        requiredScopes: input.requiredScopes,
        ttlMs: input.ttlMs,
      });

      return {
        success: true,
        pendingAuthId: pendingAuth.id,
        expiresAt: pendingAuth.expiresAt,
        message: `Created pending auth ${pendingAuth.id} for app ${input.appId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create pending auth: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
