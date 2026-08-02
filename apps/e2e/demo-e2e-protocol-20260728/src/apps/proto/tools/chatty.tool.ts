import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  steps: z.number().int().min(1).max(5).default(2),
};

const outputSchema = z.object({
  done: z.number(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

/**
 * Emits log messages and progress so the suite can prove that request-scoped
 * notifications ride THIS request's response stream — and that none are emitted
 * when the client did not opt in via `_meta` `logLevel` / `progressToken`.
 */
@Tool({
  name: 'chatty',
  description: 'Reports progress and logs while it works',
  inputSchema,
  outputSchema,
})
export default class ChattyTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    await this.notify('starting work', 'debug');

    for (let step = 1; step <= input.steps; step++) {
      await this.progress(step, input.steps, `step ${step}`);
      await this.notify({ message: `finished step ${step}`, step }, 'info');
    }

    await this.notify('all done', 'warning');
    return { done: input.steps };
  }
}
