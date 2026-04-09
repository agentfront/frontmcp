import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {};

const outputSchema = z.object({
  status: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'unflagged',
  description: 'Tool without any feature flag - always visible',
  inputSchema,
  outputSchema,
})
export default class UnflaggedTool extends ToolContext {
  async execute(_input: Input): Promise<Output> {
    return {
      status: 'always available',
    };
  }
}
