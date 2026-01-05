import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import '@frontmcp/plugin-remember'; // Import for this.remember types

const inputSchema = z
  .object({
    key: z.string().describe('Key to recall'),
    scope: z
      .enum(['session', 'user', 'tool', 'global'])
      .optional()
      .default('session')
      .describe('Scope to look up the memory in'),
  })
  .strict();

const outputSchema = z.object({
  found: z.boolean(),
  key: z.string(),
  value: z.string().nullable(),
  scope: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'recall-value',
  description: 'Recall a previously stored value from memory',
  inputSchema,
  outputSchema,
})
export default class RecallValueTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const value = await this.remember.get<string>(input.key, {
      scope: input.scope,
    });

    return {
      found: value !== undefined,
      key: input.key,
      value: value ?? null,
      scope: input.scope,
    };
  }
}
