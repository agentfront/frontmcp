/**
 * GitHub Repos Tool - Lists user repositories
 *
 * This is a demo tool for E2E testing of multi-provider orchestrated auth.
 * In a full implementation, it would use the orchestration accessor to get tokens.
 */
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({
  limit: z.number().optional().default(10).describe('Maximum number of repos to list'),
});

const outputSchema = z.object({
  success: z.boolean(),
  tokenReceived: z.boolean(),
  tokenPrefix: z.string().optional().describe('First 10 chars of token (for debugging)'),
  providerId: z.string().optional(),
  repos: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
});

@Tool({
  name: 'github-repos',
  description: 'List GitHub repositories using upstream OAuth token',
  inputSchema,
  outputSchema,
})
export class GitHubReposTool extends ToolContext {
  async execute(_input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    // For E2E testing, check if the auth info contains federated provider claims
    // In a full implementation, this would use orchestration.tryGetToken('github')
    const authInfo = this.getAuthInfo();
    const user = authInfo?.user as { federated?: { selectedProviders?: string[] } } | undefined;

    // Check if federated claims indicate github was selected
    const federatedClaims = user?.federated;
    const hasGitHub = federatedClaims?.selectedProviders?.includes('github') ?? false;

    if (!hasGitHub) {
      return {
        success: false,
        tokenReceived: false,
        error: 'GitHub provider not authorized',
      };
    }

    // In E2E test context without full OAuth flow, return success with mock data
    return {
      success: true,
      tokenReceived: false, // No actual token without full OAuth flow
      providerId: 'github',
      repos: [
        { name: 'mock-repo-1', description: 'Mock repository for testing' },
        { name: 'mock-repo-2', description: 'Another mock repository' },
      ],
    };
  }
}
