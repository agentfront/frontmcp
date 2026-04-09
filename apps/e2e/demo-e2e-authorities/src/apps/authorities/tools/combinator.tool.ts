import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { action: z.string().default('combined') };
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'combinator-tool',
  description: 'A tool testing nested combinators (anyOf with allOf and not)',
  inputSchema,
  authorities: {
    anyOf: [
      { roles: { any: ['superadmin'] } },
      {
        allOf: [{ roles: { any: ['admin', 'manager'] } }, { not: { roles: { any: ['suspended'] } } }],
      },
    ],
  },
})
export default class CombinatorTool extends ToolContext {
  async execute(input: Input) {
    return { result: input.action };
  }
}
