import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  delayMs: z.number().default(0),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'combined-guard',
  description: 'A tool with rate limit, concurrency, and timeout guards',
  inputSchema,
  rateLimit: {
    maxRequests: 5,
    windowMs: 5000,
    partitionBy: 'global',
  },
  concurrency: {
    maxConcurrent: 2,
    queueTimeoutMs: 1000,
  },
  timeout: {
    executeMs: 2000,
  },
})
export default class CombinedGuardTool extends ToolContext {
  async execute(input: Input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}
