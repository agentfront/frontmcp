import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { executionTracker } from '../data/execution-tracker';

const inputSchema = {
  _dummy: z.string().optional().describe('Unused'),
};

const outputSchema = z.object({
  executionCounts: z.record(z.string(), z.number()),
  message: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-cache-stats',
  description: 'Get execution statistics to verify cache behavior',
  inputSchema,
  outputSchema,
})
export default class GetCacheStatsTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    const counts = executionTracker.getAll();

    return {
      executionCounts: counts,
      message: `Tracked ${Object.keys(counts).length} tools with a total of ${Object.values(counts).reduce(
        (a, b) => a + b,
        0,
      )} executions`,
    };
  }
}
