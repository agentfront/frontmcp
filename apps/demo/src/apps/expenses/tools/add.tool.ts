import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: ['string', 'number'],
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    const result = input.a + input.b;
    return [`${input.a}+${input.b}=${result}`, result];
  }
}
