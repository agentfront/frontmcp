import { z } from 'zod';

import { PublicMcpError, Tool, ToolContext } from '@frontmcp/sdk';

/**
 * Used by the cli-errors e2e suite (#369 / #378) to verify that:
 *   - `this.fail(new PublicMcpError(...))` surfaces the public message all
 *     the way to CLI stderr (no "Unknown error" wrapper).
 *   - The CLI exits 1 (runtime error), not 2 (usage error).
 */
@Tool({
  name: 'divide',
  description: 'Divide a by b',
  inputSchema: {
    a: z.number().describe('Dividend'),
    b: z.number().describe('Divisor'),
  },
})
export default class DivideTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    if (input.b === 0) {
      this.fail(new PublicMcpError('Cannot divide by zero', 'INVALID_PARAMS'));
    }
    return { result: input.a / input.b };
  }
}
