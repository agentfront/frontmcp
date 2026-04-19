import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  prNumber: z.number().describe('The pull request number'),
  comment: z.string().describe('The comment text to add'),
};

const outputSchema = {
  commentId: z.number(),
  success: z.boolean(),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

@Tool({
  name: 'github_add_comment',
  description: 'Add a comment to a GitHub pull request',
  inputSchema,
  outputSchema,
  tags: ['github', 'pr', 'comment'],
})
export class GitHubAddCommentTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    // Mock implementation for testing
    return {
      commentId: Math.floor(Math.random() * 10000),
      success: true,
    };
  }
}
