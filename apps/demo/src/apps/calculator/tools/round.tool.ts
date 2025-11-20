import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'round',
  description: 'Round x to nearest integer or to a given number of decimal places',
  inputSchema: {
    x: z.number(),
    digits: z.number().int().min(0).max(15).optional(),
  },
  outputSchema: 'number',
})
export default class RoundTool extends ToolContext {
  async execute(input: { x: number; digits?: number }) {
    const { x, digits } = input;
    if (digits === undefined) {
      return Math.round(x);
    }
    const factor = Math.pow(10, digits);
    return Math.round((x + Number.EPSILON) * factor) / factor;
  }
}
