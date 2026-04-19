import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'min',
  description: 'Minimum value in an array of numbers',
  inputSchema: { values: z.array(z.number()).min(1) },
  outputSchema: 'number',
})
export default class MinTool extends ToolContext {
  async execute(input: { values: number[] }) {
    return Math.min(...input.values);
  }
}
