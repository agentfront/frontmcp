import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'multiply',
  description: 'Multiply two numbers',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})
export default class MultiplyTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a * input.b;
  }
}
