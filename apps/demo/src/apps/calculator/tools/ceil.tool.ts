import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'ceil',
  description: 'Ceil of x (smallest integer ≥ x)',
  inputSchema: { x: z.number() },
  outputSchema: 'number',
})
export default class CeilTool extends ToolContext {
  async execute(input: { x: number }) {
    return Math.ceil(input.x);
  }
}
