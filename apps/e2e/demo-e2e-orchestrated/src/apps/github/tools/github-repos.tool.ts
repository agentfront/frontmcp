/**
 * GitHub Repos Tool - Lists user repositories
 *
 * This is a demo tool for E2E testing of multi-provider orchestrated auth.
 * In a full implementation, it would use the orchestration accessor to get tokens.
 */
import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  limit: z.number().int().min(1).optional().default(10).describe('Maximum number of repos to list'),
};

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
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    // Orchestrated auth: `this.orchestration` is bound for authenticated requests.
    if (!this.orchestration.isAuthenticated) {
      return {
        success: false,
        tokenReceived: false,
        error: 'User is not authenticated',
      };
    }

    // Read the downstream GitHub token via orchestration. tryGetToken returns
    // null when the provider was not linked (e.g. user skipped GitHub), so this
    // doubles as the "provider not authorized" check.
    const token = await this.orchestration.tryGetToken('github');

    if (!token) {
      return {
        success: false,
        tokenReceived: false,
        providerId: 'github',
        error: 'GitHub provider not authorized',
      };
    }

    // A real tool would call the GitHub API with the token; for the E2E we
    // confirm the token was retrieved and echo a non-secret prefix.
    const allRepos = [
      { name: 'mock-repo-1', description: 'Mock repository for testing' },
      { name: 'mock-repo-2', description: 'Another mock repository' },
      { name: 'mock-repo-3', description: 'Third mock repository' },
    ];

    return {
      success: true,
      tokenReceived: true,
      tokenPrefix: token.slice(0, 10),
      providerId: 'github',
      repos: allRepos.slice(0, input.limit),
    };
  }
}
