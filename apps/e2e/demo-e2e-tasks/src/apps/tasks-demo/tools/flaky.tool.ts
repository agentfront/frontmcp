import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  shouldFail: z.boolean().default(true),
};

const outputSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string() })),
  isError: z.boolean().optional(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

/**
 * Returns a CallToolResult with `isError: true` so we can assert the spec's
 * "isError → task `failed` status" behaviour.
 */
@Tool({
  name: 'flaky',
  description: 'Returns isError: true on demand; validates task failure propagation.',
  inputSchema,
  outputSchema,
  execution: { taskSupport: 'optional' },
})
export default class FlakyTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    if (input.shouldFail) {
      return {
        content: [{ type: 'text', text: 'Simulated tool-level failure' }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: 'Happy path' }],
      isError: false,
    };
  }
}
