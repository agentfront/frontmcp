import { Tool, ToolContext, PublicMcpError } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  errorCode: z.string().describe('Custom error code'),
  errorMessage: z.string().describe('Custom error message'),
  statusCode: z.number().default(400).describe('HTTP status code'),
  trigger: z.boolean().default(true).describe('Whether to trigger the custom error'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
  })
  .strict();

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'throw-custom-error',
  description: 'Throws a custom PublicMcpError with specified code and message',
  inputSchema,
  outputSchema,
})
export default class ThrowCustomErrorTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    if (input.trigger) {
      throw new PublicMcpError(input.errorMessage, input.errorCode, input.statusCode);
    }
    return { success: true };
  }
}
