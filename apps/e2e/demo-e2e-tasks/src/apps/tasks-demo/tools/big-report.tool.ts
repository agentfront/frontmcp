import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  topic: z.string().describe('Report topic'),
};

const outputSchema = z.object({
  topic: z.string(),
  pages: z.number(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * `taskSupport: 'required'` — clients MUST invoke as a task; synchronous calls
 * are rejected with JSON-RPC `-32601` (Method not found).
 */
@Tool({
  name: 'big-report',
  description: 'Expensive report generator, task-only.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'required' },
})
export default class BigReportTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    await new Promise((r) => setTimeout(r, 150));
    return { topic: input.topic, pages: 42 };
  }
}
