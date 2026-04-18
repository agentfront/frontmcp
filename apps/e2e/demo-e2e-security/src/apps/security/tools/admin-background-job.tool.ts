import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { label: z.string() };
const outputSchema = z.object({ label: z.string(), processed: z.boolean() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Admin-only AND task-augmentable. Exercises the security fix that moved
 * `createTaskIfRequested` AFTER the authority check: a non-admin sending
 * `{ task: {} }` must get a synchronous denial — not a taskId that later
 * "silently" fails — so unauthorized callers can't enumerate tool existence
 * or mint task records.
 */
@Tool({
  name: 'admin-background-job',
  description: 'Admin-only background job. Authority check runs before task creation.',
  inputSchema,
  outputSchema,
  authorities: 'admin',
  execution: { taskSupport: 'optional' },
})
export default class AdminBackgroundJobTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { label: input.label, processed: true };
  }
}
