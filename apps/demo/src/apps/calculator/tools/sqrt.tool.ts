import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'sqrt',
  description: 'Square root of x',
  inputSchema: { x: z.number().nonnegative('x must be >= 0') },
  outputSchema: 'number',
})
export default class SqrtTool extends ToolContext {
  async execute(input: { x: number }) {
    return Math.sqrt(input.x);
  }
}
