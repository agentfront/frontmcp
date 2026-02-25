import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { executionTracker } from '../data/execution-tracker';

const inputSchema = {};

const outputSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'reset-stats',
  description: 'Reset execution statistics for fresh testing',
  inputSchema,
  outputSchema,
})
export default class ResetStatsTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    executionTracker.reset();

    return {
      success: true,
      message: 'Execution statistics have been reset',
    };
  }
}
