import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  delayMs: z.number().default(0),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'slow-tool',
  description: 'A slow tool that inherits the default 5000ms app timeout',
  inputSchema,
})
export default class SlowTool extends ToolContext {
  async execute(input: Input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { completedAfterMs: input.delayMs };
  }
}
