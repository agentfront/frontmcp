import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  delayMs: z.number().default(0),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'concurrency-queued',
  description: 'A mutex tool with queue (maxConcurrent: 1, queueTimeout: 3s)',
  inputSchema,
  concurrency: {
    maxConcurrent: 1,
    queueTimeoutMs: 3000,
  },
})
export default class ConcurrencyQueuedTool extends ToolContext {
  async execute(input: Input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}
