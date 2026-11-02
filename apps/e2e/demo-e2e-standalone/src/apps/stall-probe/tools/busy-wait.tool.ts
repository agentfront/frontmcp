import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'busy-wait',
  description: 'Blocks the event loop for the given number of milliseconds',
  inputSchema: { ms: z.number().int().min(1).max(5000) },
})
export default class BusyWaitTool extends ToolContext {
  async execute(input: { ms: number }): Promise<string> {
    const end = Date.now() + input.ms;
    while (Date.now() < end) {
      // Busy-waits on purpose: the stall detector must name this tool.
    }
    return `blocked for ${input.ms} ms`;
  }
}
