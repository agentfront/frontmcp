import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  name: z.string().default('World'),
};

const outputSchema = z.object({
  message: z.string(),
  scope: z.literal('isolated'),
});

type Input = z.output<typeof inputSchema>;
type Output = z.output<typeof outputSchema>;

@Tool({
  name: 'isolated-hello',
  description: 'A simple hello tool in the isolated standalone app',
  inputSchema,
  outputSchema,
})
export default class IsolatedHelloTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const { name } = input;
    return {
      message: `Hello, ${name}! This is from the isolated standalone app.`,
      scope: 'isolated',
    };
  }
}
