import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string().describe('The message to echo back'),
};

const outputSchema = z.object({
  echo: z.string(),
  receivedAt: z.string(),
});

type EchoInput = z.infer<z.ZodObject<typeof inputSchema>>;
type EchoOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'echo',
  description: 'Echoes the input message back - useful for connectivity testing',
  inputSchema,
  outputSchema,
})
export default class EchoTool extends ToolContext {
  async execute(input: EchoInput): Promise<EchoOutput> {
    return {
      echo: input.message,
      receivedAt: new Date().toISOString(),
    };
  }
}
