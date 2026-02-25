import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID'),
  appId: z.string().optional().describe('Filter by application ID'),
  providerId: z.string().optional().describe('Filter by provider ID (requires appId)'),
}.refine((data) => !data.providerId || data.appId, {
  message: 'providerId requires appId to be specified',
  path: ['providerId'],
});

const credentialSchema = z.object({
  appId: z.string(),
  providerId: z.string(),
  type: z.string(),
  isValid: z.boolean(),
  expiresAt: z.number().optional(),
  createdAt: z.number(),
});

const outputSchema = z
  .object({
    success: z.boolean(),
    credentials: z.array(credentialSchema),
    count: z.number(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'get-credentials',
  description: 'Get credentials from an authorization vault entry',
  inputSchema,
  outputSchema,
})
export default class GetCredentialsTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    let credentials;

    if (input.appId && input.providerId) {
      // Get specific credential
      const cred = await vault.getCredential(input.entryId, input.appId, input.providerId);
      credentials = cred ? [cred] : [];
    } else if (input.appId) {
      // Get credentials for app
      credentials = await vault.getAppCredentials(input.entryId, input.appId);
    } else {
      // Get all credentials
      credentials = await vault.getAllCredentials(input.entryId);
    }

    const mapped = credentials.map((c) => ({
      appId: c.appId,
      providerId: c.providerId,
      type: c.credential.type,
      isValid: c.isValid,
      expiresAt: c.expiresAt,
      createdAt: c.acquiredAt,
    }));

    return {
      success: true,
      credentials: mapped,
      count: mapped.length,
      message: `Found ${mapped.length} credential(s)`,
    };
  }
}
