import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  message: z.string(),
};

const outputSchema = z.object({ echo: z.string() });

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * No `execution.taskSupport` declared — the default per MCP spec is
 * `'forbidden'`. Task-augmented calls MUST be rejected with `-32601`.
 */
@Tool({
  name: 'instant-echo',
  description: 'Synchronous-only tool (default forbidden taskSupport).',
  inputSchema,
  outputSchema,
})
export default class InstantEchoTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return { echo: input.message };
  }
}
