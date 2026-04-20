import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { executionTracker } from '../data/execution-tracker';

const inputSchema = {
  operationId: z.string().describe('Unique operation identifier'),
};

const outputSchema = z.object({
  operationId: z.string(),
  result: z.number(),
  executionCount: z.number(),
  computedAt: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'non-cached',
  description: 'Simulates a computation without caching',
  inputSchema,
  outputSchema,
  // No cache configuration - every call executes
})
export default class NonCachedTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    // Track actual execution
    const executionCount = executionTracker.increment('non-cached');

    // Simple computation
    const result = input.operationId.length * 10;

    return {
      operationId: input.operationId,
      result,
      executionCount,
      computedAt: new Date().toISOString(),
    };
  }
}
