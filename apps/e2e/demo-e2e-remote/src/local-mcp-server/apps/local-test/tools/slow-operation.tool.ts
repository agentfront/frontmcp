import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  delayMs: z.number().min(0).max(100000).describe('Delay in milliseconds (max ~100s to fit E2E timeout)'),
};

const outputSchema = z.object({
  completed: z.boolean(),
  actualDelayMs: z.number(),
  startedAt: z.string(),
  completedAt: z.string(),
});

type SlowOperationInput = z.infer<z.ZodObject<typeof inputSchema>>;
type SlowOperationOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'slow-operation',
  description: 'Delays response by specified milliseconds - useful for timeout testing',
  inputSchema,
  outputSchema,
})
export default class SlowOperationTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: SlowOperationInput): Promise<SlowOperationOutput> {
    const startedAt = new Date();

    // Wait for the specified delay
    await new Promise((resolve) => setTimeout(resolve, input.delayMs));

    const completedAt = new Date();

    return {
      completed: true,
      actualDelayMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
  }
}
