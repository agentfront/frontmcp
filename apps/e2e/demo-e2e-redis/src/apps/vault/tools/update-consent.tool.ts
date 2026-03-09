import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';
import type { VaultConsentRecord } from '@frontmcp/auth';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID'),
  enabled: z.boolean().describe('Whether consent is enabled'),
  selectedToolIds: z.array(z.string()).optional().describe('IDs of consented tools'),
  availableToolIds: z.array(z.string()).optional().describe('IDs of available tools at consent time'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'update-consent',
  description: 'Update consent settings for a vault entry',
  inputSchema,
  outputSchema,
})
export default class UpdateConsentTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    const consent: VaultConsentRecord = {
      enabled: input.enabled,
      selectedToolIds: input.selectedToolIds ?? [],
      availableToolIds: input.availableToolIds ?? [],
      consentedAt: Date.now(),
      version: '1.0',
    };

    await vault.updateConsent(input.entryId, consent);

    return {
      success: true,
      message: `Updated consent for vault entry ${input.entryId}`,
    };
  }
}
