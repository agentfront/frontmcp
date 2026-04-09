import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string().default('hello'),
};

type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'rate-limited',
  description: 'A rate-limited echo tool (3 requests per 5 seconds)',
  inputSchema,
  rateLimit: {
    maxRequests: 3,
    windowMs: 5000,
    partitionBy: 'global',
  },
})
export default class RateLimitedTool extends ToolContext {
  async execute(input: Input) {
    return { echo: input.message };
  }
}
