import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  steps: z.number().int().min(1).max(10).describe('Number of progress steps to send'),
  delayMs: z.number().int().min(0).max(500).optional().describe('Delay between steps in milliseconds'),
  includeTotal: z.boolean().optional().describe('If true, include total in progress notification'),
  includeMessage: z.boolean().optional().describe('If true, include message in progress notification'),
};

const outputSchema = z.object({
  success: z.boolean(),
  progressSent: z.number(),
  hadProgressToken: z.boolean(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Tool that tests the this.progress() method on ToolContext.
 * This calls the context's progress() method which sends progress notifications
 * to the current session using the progressToken from the request's _meta.
 */
@Tool({
  name: 'test-progress-method',
  description: 'Tests the this.progress() method for sending progress notifications',
  inputSchema,
  outputSchema,
})
export default class TestProgressMethodTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    let progressSent = 0;
    const total = input.includeTotal ? input.steps : undefined;

    for (let i = 1; i <= input.steps; i++) {
      if (input.delayMs && input.delayMs > 0) {
        await this.delay(input.delayMs);
      }

      const message = input.includeMessage ? `Step ${i} of ${input.steps}` : undefined;
      const sent = await this.progress(i, total, message);

      if (sent) {
        progressSent++;
      }
    }

    return {
      success: true,
      progressSent,
      hadProgressToken: progressSent > 0,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
