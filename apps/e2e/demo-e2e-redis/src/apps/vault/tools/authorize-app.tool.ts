import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID'),
  appId: z.string().describe('Application ID to authorize'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    isAuthorized: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'authorize-app',
  description: 'Authorize an application for a vault entry',
  inputSchema,
  outputSchema,
})
export default class AuthorizeAppTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      await vault.authorizeApp(input.entryId, input.appId);
      const isAuthorized = await vault.isAppAuthorized(input.entryId, input.appId);

      return {
        success: true,
        isAuthorized,
        message: `App ${input.appId} is ${isAuthorized ? '' : 'not '}authorized`,
      };
    } catch (error) {
      return {
        success: false,
        isAuthorized: false,
        message: `Failed to authorize app: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
