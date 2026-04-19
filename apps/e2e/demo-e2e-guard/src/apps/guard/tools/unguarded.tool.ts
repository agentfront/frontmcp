import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  value: z.string().default('test'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'unguarded',
  description: 'An unguarded echo tool (no rate limit, no concurrency, no timeout)',
  inputSchema,
})
export default class UnguardedTool extends ToolContext {
  async execute(input: Input) {
    return { echo: input.value };
  }
}
