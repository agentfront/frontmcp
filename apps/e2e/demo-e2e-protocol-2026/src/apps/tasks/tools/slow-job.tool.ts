import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  label: z.string().default('job'),
  delayMs: z.number().int().min(0).max(5_000).default(150),
};

const outputSchema = z.object({
  label: z.string(),
  finished: z.boolean(),
});

type Input = z.output<z.ZodObject<typeof inputSchema>>;
type Output = z.output<typeof outputSchema>;

/**
 * A long-running operation. Under 2026-07-28 a client that declares the tasks
 * extension gets a `resultType: "task"` handle back and polls `tasks/get`.
 */
@Tool({
  name: 'slow-job',
  description: 'Runs for a while and then reports completion',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class SlowJobTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    return { label: input.label, finished: true };
  }
}
