import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import '@frontmcp/plugin-remember'; // Import for this.remember types

const inputSchema = z
  .object({
    key: z.string().describe('Key to forget'),
    scope: z
      .enum(['session', 'user', 'tool', 'global'])
      .optional()
      .default('session')
      .describe('Scope of the memory to forget'),
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
  name: 'forget-value',
  description: 'Forget a previously stored value',
  inputSchema,
  outputSchema,
})
export default class ForgetValueTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    await this.remember.forget(input.key, {
      scope: input.scope,
    });

    return {
      success: true,
      key: input.key,
      scope: input.scope,
      message: `Forgot "${input.key}" from scope "${input.scope}"`,
    };
  }
}
