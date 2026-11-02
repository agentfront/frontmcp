import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  reviews: z.array(z.string()),
  count: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'review_list',
  aliases: ['review.list'],
  description: 'List the pending reviews',
  inputSchema,
  outputSchema,
})
export default class ReviewListTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    const reviews = ['PR-17 waits for a second approval'];
    return { reviews, count: reviews.length };
  }
}
