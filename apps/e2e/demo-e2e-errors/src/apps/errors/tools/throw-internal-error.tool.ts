import { z } from '@frontmcp/lazy-zod';
import { InternalMcpError, Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  trigger: z.boolean().default(true).describe('Whether to trigger the internal error'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'throw-internal-error',
  description: 'Throws an InternalMcpError (server error)',
  inputSchema,
  outputSchema,
})
export default class ThrowInternalErrorTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    if (input.trigger) {
      throw new InternalMcpError('Simulated internal server error', 'SIMULATED_INTERNAL_ERROR');
    }

    return {
      success: true,
    };
  }
}
