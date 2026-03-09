import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { executionTracker } from '../data/execution-tracker';

const inputSchema = {
  operationId: z.string().describe('Unique operation identifier'),
  complexity: z.number().optional().default(1).describe('Complexity factor (1-10)'),
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
  name: 'expensive-operation',
  description: 'Simulates an expensive computation with caching enabled',
  inputSchema,
  outputSchema,
  cache: {
    ttl: 30, // 30 second TTL
  },
})
export default class ExpensiveOperationTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Track actual execution
    const executionCount = executionTracker.increment('expensive-operation');

    // Simulate expensive computation
    const result = Math.pow(input.complexity, 2) * 100 + input.operationId.length;

    return {
      operationId: input.operationId,
      result,
      executionCount,
      computedAt: new Date().toISOString(),
    };
  }
}
