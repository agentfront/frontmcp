import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  prNumber: z.number().describe('The pull request number'),
};

const outputSchema = {
  pr: z.object({
    number: z.number(),
    title: z.string(),
    author: z.string(),
    status: z.enum(['open', 'closed', 'merged']),
    files: z.array(z.string()),
  }),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

@Tool({
  name: 'github_get_pr',
  description: 'Get details of a GitHub pull request',
  inputSchema,
  outputSchema,
  tags: ['github', 'pr'],
})
export class GitHubGetPRTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    // Mock implementation for testing
    return {
      pr: {
        number: input.prNumber,
        title: `Test PR #${input.prNumber}`,
        author: 'test-user',
        status: 'open',
        files: ['src/index.ts', 'src/utils.ts', 'README.md'],
      },
    };
  }
}
