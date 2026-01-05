import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import '@frontmcp/plugin-remember'; // Import for this.remember types

const inputSchema = z
  .object({
    scope: z
      .enum(['session', 'user', 'tool', 'global'])
      .optional()
      .default('session')
      .describe('Scope to list memories from'),
    pattern: z.string().optional().describe('Optional pattern to filter keys'),
  })
  .strict();

const outputSchema = z.object({
  scope: z.string(),
  keys: z.array(z.string()),
  count: z.number(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'list-memories',
  description: 'List all stored memories in a scope',
  inputSchema,
  outputSchema,
})
export default class ListMemoriesTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const keys = await this.remember.list({
      scope: input.scope,
      pattern: input.pattern,
    });

    return {
      scope: input.scope,
      keys,
      count: keys.length,
    };
  }
}
