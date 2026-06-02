/**
 * Whoami Tool — reads the upstream provider token via orchestration.
 *
 * In `mode: 'remote'` FrontMCP proxies authentication to a single upstream IdP
 * and stores that IdP's token (encrypted) keyed to the session. This tool reads
 * it back via `this.orchestration.getToken('upstream')` to prove the downstream
 * token is available to tools. A real tool would call the upstream API with it;
 * here we only echo whether the token was received (never the token or any
 * token-derived material).
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  authenticated: z.boolean(),
  tokenReceived: z.boolean(),
  providerId: z.string().optional(),
  error: z.string().optional(),
});

@Tool({
  name: 'whoami',
  description: 'Read the upstream IdP token via orchestration (remote-proxy mode)',
  inputSchema,
  outputSchema,
})
export class WhoamiTool extends ToolContext {
  // The remote provider id is pinned to 'upstream' via providerConfig.id in main.ts.
  private static readonly PROVIDER_ID = 'upstream';

  async execute(_input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    if (!this.orchestration.isAuthenticated) {
      return { authenticated: false, tokenReceived: false, error: 'User is not authenticated' };
    }

    const token = await this.orchestration.tryGetToken(WhoamiTool.PROVIDER_ID);
    if (!token) {
      return {
        authenticated: true,
        tokenReceived: false,
        providerId: WhoamiTool.PROVIDER_ID,
        error: 'Upstream provider token not available',
      };
    }

    return {
      authenticated: true,
      tokenReceived: true,
      providerId: WhoamiTool.PROVIDER_ID,
    };
  }
}
