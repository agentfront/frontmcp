import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  maxMs: z.number().int().min(100).max(30_000).default(10_000),
};

const outputSchema = z.object({
  waitedMs: z.number(),
  cancelled: z.boolean(),
  pid: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Observes the AbortSignal surfaced by the task runner. In CLI mode this
 * signal fires when the parent sends SIGTERM via `tasks/cancel`.
 */
@Tool({
  name: 'cancellable-wait',
  description: 'Sleeps up to maxMs unless the task runner aborts us.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class CancellableWaitTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const start = Date.now();
    const cancelled = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), input.maxMs);
      const signal = this.signal;
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          resolve(true);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
    return { waitedMs: Date.now() - start, cancelled, pid: process.pid };
  }
}
