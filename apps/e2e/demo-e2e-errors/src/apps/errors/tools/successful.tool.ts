import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string().default('Success').describe('Success message'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'successful-tool',
  description: 'A tool that always succeeds (for comparison)',
  inputSchema,
  outputSchema,
})
export default class SuccessfulTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return {
      success: true,
      message: input.message,
    };
  }
}
