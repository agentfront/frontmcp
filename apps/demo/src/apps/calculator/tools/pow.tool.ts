import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'pow',
  description: 'Raise a to the power of b (a^b)',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: 'number',
})
export default class PowTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return Math.pow(input.a, input.b);
  }
}
