import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'add-numbers',
  description: 'Adds two numbers together',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
})
export class AddNumbersTool extends ToolContext {
  async execute(input: { a: number; b: number }): Promise<{ result: number }> {
    return {
      result: input.a + input.b,
    };
  }
}
