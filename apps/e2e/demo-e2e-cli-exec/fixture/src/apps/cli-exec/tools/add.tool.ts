import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'add',
  description: 'Add two numbers together',
  inputSchema: {
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  },
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number; b: number }) {
    // The CLI logging e2e asserts that WARN-level server logs reach the log file.
    this.logger.warn('add tool invoked', { a: input.a, b: input.b });
    return { result: input.a + input.b };
  }
}
