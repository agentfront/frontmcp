import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    message: z.string().default('Success').describe('Success message'),
  })
  .strict();

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'successful-tool',
  description: 'A tool that always succeeds (for comparison)',
  inputSchema,
  outputSchema,
})
export default class SuccessfulTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      success: true,
      message: input.message,
    };
  }
}
