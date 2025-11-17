import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'abs',
  description: 'Absolute value of x',
  inputSchema: { x: z.number() },
  outputSchema: 'number',
})
export default class AbsTool extends ToolContext {
  async execute(input: { x: number }) {
    return Math.abs(input.x);
  }
}
