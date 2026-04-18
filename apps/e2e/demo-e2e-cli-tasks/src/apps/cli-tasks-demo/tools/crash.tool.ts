import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  delayMs: z.number().int().min(0).max(10_000).default(500),
};

const outputSchema = z.object({ shouldNeverSee: z.boolean() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * SIGKILLs its own worker process after `delayMs`. Used by the e2e to
 * simulate an orphaned task — the executor PID dies without transitioning
 * the record to a terminal state, and the store must auto-fail on the next read.
 */
@Tool({
  name: 'crash',
  description: 'Intentionally kills the worker process to exercise orphan detection.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class CrashTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    setTimeout(() => {
      process.kill(process.pid, 'SIGKILL');
    }, input.delayMs);
    await new Promise(() => {
      /* hang forever, waiting for the SIGKILL above */
    });
    return { shouldNeverSee: true };
  }
}
