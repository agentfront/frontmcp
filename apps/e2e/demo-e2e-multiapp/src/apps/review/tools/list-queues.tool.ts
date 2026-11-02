import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  queues: z.array(z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list',
  description: 'List the review queues',
  inputSchema,
  outputSchema,
})
export default class ListQueuesTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return { queues: ['frontend', 'backend'] };
  }
}
