import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string().default('hello'),
};

const outputSchema = z.object({
  echoed: z.string(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

@Tool({
  name: 'echo',
  description: 'Echoes the provided message back to the caller',
  inputSchema,
  outputSchema,
})
export default class EchoTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { echoed: input.message };
  }
}
