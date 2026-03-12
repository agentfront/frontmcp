import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

@Tool({
  name: 'failing-tool',
  description: 'A tool that always fails (for testing error handling)',
  inputSchema: {
    input: z.string().optional().describe('Optional input'),
  },
})
export class FailingTool extends ToolContext {
  async execute(_input: { input?: string }): Promise<never> {
    throw new Error('Intentional test failure');
  }
}
