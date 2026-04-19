import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a + input.b;
  }
}
