import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getVault } from '../data/vault.store';

const inputSchema = {
  entryId: z.string().describe('Vault entry ID'),
  pendingAuthId: z.string().describe('Pending auth ID to complete'),
  action: z.enum(['complete', 'cancel']).describe('Action to take'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'complete-pending-auth',
  description: 'Complete or cancel a pending incremental auth request',
  inputSchema,
  outputSchema,
})
export default class CompletePendingAuthTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const vault = await getVault(sessionId);

    try {
      if (input.action === 'complete') {
        await vault.completePendingAuth(input.entryId, input.pendingAuthId);
        return {
          success: true,
          message: `Completed pending auth ${input.pendingAuthId}`,
        };
      } else {
        await vault.cancelPendingAuth(input.entryId, input.pendingAuthId);
        return {
          success: true,
          message: `Cancelled pending auth ${input.pendingAuthId}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to ${input.action} pending auth: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
