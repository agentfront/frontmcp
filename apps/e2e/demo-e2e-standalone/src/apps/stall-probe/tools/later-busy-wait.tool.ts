import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext, trackWork } from '@frontmcp/sdk';

/** Returns at once, then blocks the event loop from a timer, in a span trackWork() opens. */
@Tool({
  name: 'later-busy-wait',
  description: 'Blocks the event loop from a timer, after the call returned',
  inputSchema: { ms: z.number().int().min(1).max(5000) },
})
export default class LaterBusyWaitTool extends ToolContext {
  async execute(input: { ms: number }): Promise<string> {
    const timer = setTimeout(() => {
      const done = trackWork('stall-probe:timer');
      try {
        const end = Date.now() + input.ms;
        while (Date.now() < end) {
          // Busy-waits on purpose, outside the call: the stall detector must name the work span.
        }
      } finally {
        done();
      }
    }, 300);
    timer.unref?.();
    return `blocks for ${input.ms} ms in 300 ms`;
  }
}
