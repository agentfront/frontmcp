import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';
import type { AppCredential, Credential } from '@frontmcp/auth';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID'),
  appId: z.string().describe('Application ID'),
  providerId: z.string().describe('Provider ID'),
  credentialType: z.enum(['oauth', 'api_key', 'bearer', 'basic']).describe('Credential type'),
  // OAuth fields
  accessToken: z.string().optional().describe('OAuth access token'),
  refreshToken: z.string().optional().describe('OAuth refresh token'),
  scopes: z.array(z.string()).optional().describe('OAuth scopes'),
  // API key fields
  apiKey: z.string().optional().describe('API key value'),
  headerName: z.string().optional().describe('Header name for API key'),
  // Bearer fields
  bearerToken: z.string().optional().describe('Bearer token value'),
  // Basic auth fields
  username: z.string().optional().describe('Basic auth username'),
  password: z.string().optional().describe('Basic auth password'),
  // Common fields
  expiresAt: z.number().optional().describe('Credential expiration timestamp (epoch ms)'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'add-credential',
  description: 'Add a credential to an authorization vault entry',
  inputSchema,
  outputSchema,
})
export default class AddCredentialTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    let credential: Credential;

    switch (input.credentialType) {
      case 'oauth':
        credential = {
          type: 'oauth',
          accessToken: input.accessToken ?? 'mock-access-token',
          refreshToken: input.refreshToken,
          tokenType: 'Bearer',
          expiresAt: input.expiresAt,
          scopes: input.scopes ?? [],
        };
        break;
      case 'api_key':
        credential = {
          type: 'api_key',
          key: input.apiKey ?? 'mock-api-key',
          headerName: input.headerName ?? 'X-API-Key',
        };
        break;
      case 'bearer':
        credential = {
          type: 'bearer',
          token: input.bearerToken ?? 'mock-bearer-token',
        };
        break;
      case 'basic':
        credential = {
          type: 'basic',
          username: input.username ?? 'user',
          password: input.password ?? 'pass',
        };
        break;
      default:
        return {
          success: false,
          message: `Unsupported credential type: ${input.credentialType}`,
        };
    }

    const appCredential: AppCredential = {
      appId: input.appId,
      providerId: input.providerId,
      credential,
      acquiredAt: Date.now(),
      isValid: true,
      expiresAt: input.expiresAt,
    };

    await vault.addAppCredential(input.entryId, appCredential);

    return {
      success: true,
      message: `Added ${input.credentialType} credential for app ${input.appId}`,
    };
  }
}
