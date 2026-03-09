import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'divide',
  description: 'Divide a by b',
  inputSchema: { a: z.number(), b: z.number().refine((n) => n !== 0, 'Division by zero is not allowed') },
  outputSchema: 'number',
})
export default class DivideTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return input.a / input.b;
  }
}
