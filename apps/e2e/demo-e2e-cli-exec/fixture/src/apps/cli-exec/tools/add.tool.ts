import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers together',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return { result: input.a + input.b };
  }
}
