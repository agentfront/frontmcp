import { Tool, ToolContext, PublicMcpError } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    errorCode: z.string().describe('Custom error code'),
    errorMessage: z.string().describe('Custom error message'),
    statusCode: z.number().optional().default(400).describe('HTTP status code'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'throw-custom-error',
  description: 'Throws a custom PublicMcpError with specified code and message',
  inputSchema,
  outputSchema,
})
export default class ThrowCustomErrorTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    throw new PublicMcpError(input.errorMessage, input.errorCode, input.statusCode);
  }
}
