/**
 * GitHub User Tool - Gets user info
 *
 * This is a demo tool for E2E testing of multi-provider orchestrated auth.
 * In a full implementation, it would use the orchestration accessor to get tokens.
 */
import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = z.object({
  success: z.boolean(),
  isAuthenticated: z.boolean(),
  hasProvider: z.boolean(),
  providerId: z.string().optional(),
  user: z
    .object({
      login: z.string().optional(),
      id: z.number().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
});

@Tool({
  name: 'github-user',
  description: 'Get GitHub user information using upstream OAuth token',
  inputSchema,
  outputSchema,
})
export class GitHubUserTool extends ToolContext {
  async execute(_input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    // For E2E testing, check if the auth info contains federated provider claims
    // In a full implementation, this would use orchestration.tryGetToken('github')
    const authInfo = this.getAuthInfo();
    const user = authInfo?.user as { sub?: string; federated?: { selectedProviders?: string[] } } | undefined;

    const isAuthenticated = !!user?.sub;
    const federatedClaims = user?.federated;
    const hasProvider = federatedClaims?.selectedProviders?.includes('github') ?? false;

    if (!isAuthenticated) {
      return {
        success: false,
        isAuthenticated: false,
        hasProvider: false,
        error: 'User is not authenticated',
      };
    }

    if (!hasProvider) {
      return {
        success: false,
        isAuthenticated: true,
        hasProvider: false,
        error: 'GitHub provider not authorized. User needs to grant GitHub access.',
      };
    }

    // In E2E test context without full OAuth flow, return mock success data
    return {
      success: true,
      isAuthenticated: true,
      hasProvider: true,
      providerId: 'github',
      user: {
        login: 'test-user',
        id: 12345,
        name: 'Test User',
        email: 'test@github.example.com',
      },
    };
  }
}
