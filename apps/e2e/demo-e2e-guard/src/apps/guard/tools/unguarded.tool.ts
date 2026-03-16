import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  value: z.string().default('test'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'unguarded',
  description: 'An unguarded echo tool (no rate limit, no concurrency, no timeout)',
  inputSchema,
})
export default class UnguardedTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    return { echo: input.value };
  }
}
