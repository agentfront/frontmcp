import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'subtract',
  description: 'Subtract b from a',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})
export default class SubtractTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a - input.b;
  }
}
