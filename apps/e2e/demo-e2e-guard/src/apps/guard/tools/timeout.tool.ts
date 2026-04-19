import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  delayMs: z.number().default(0),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'timeout-tool',
  description: 'A tool with a 500ms timeout',
  inputSchema,
  timeout: {
    executeMs: 500,
  },
})
export default class TimeoutTool extends ToolContext {
  async execute(input: Input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}
