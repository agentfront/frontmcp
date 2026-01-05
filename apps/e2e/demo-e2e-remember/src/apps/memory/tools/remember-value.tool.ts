import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import '@frontmcp/plugin-remember'; // Import for this.remember types

const inputSchema = z
  .object({
    key: z.string().describe('Key to store the value under'),
    value: z.string().describe('Value to remember'),
    scope: z.enum(['session', 'user', 'tool', 'global']).optional().default('session').describe('Scope of the memory'),
    ttl: z.number().optional().describe('Time to live in seconds'),
  })
  .strict();

const outputSchema = z.object({
  success: z.boolean(),
  key: z.string(),
  scope: z.string(),
  message: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'remember-value',
  description: 'Store a value in session memory',
  inputSchema,
  outputSchema,
})
export default class RememberValueTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    await this.remember.set(input.key, input.value, {
      scope: input.scope,
      ttl: input.ttl,
    });

    return {
      success: true,
      key: input.key,
      scope: input.scope,
      message: `Remembered "${input.key}" with scope "${input.scope}"`,
    };
  }
}
