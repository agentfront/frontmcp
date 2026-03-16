import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  delayMs: z.number().default(0),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'concurrency-mutex',
  description: 'A mutex tool (maxConcurrent: 1, no queue)',
  inputSchema,
  concurrency: {
    maxConcurrent: 1,
    queueTimeoutMs: 0,
  },
})
export default class ConcurrencyMutexTool extends ToolContext<typeof inputSchema> {
  async execute(input: Input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}
