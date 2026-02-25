import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';

/**
 * Input schema for the forget tool.
 */
export const forgetInputSchema = {
  key: z.string().min(1).describe('What memory to forget'),
  scope: z
    .enum(['session', 'user', 'tool', 'global'])
    .optional()
    .describe('Which scope to forget from (default: session)'),
};

/**
 * Output schema for the forget tool.
 */
export const forgetOutputSchema = z.object({
  success: z.boolean(),
  key: z.string(),
  scope: z.string(),
  existed: z.boolean(),
});

export type ForgetInput = z.input<z.ZodObject<typeof forgetInputSchema>>;

export type ForgetOutput = z.infer<typeof forgetOutputSchema>;

/**
 * Tool to forget a previously remembered value.
 */
@Tool({
  name: 'forget',
  description:
    'Forget a previously remembered value. ' +
    'Use this when the user wants to delete stored preferences or information.',
  inputSchema: forgetInputSchema,
  outputSchema: forgetOutputSchema,
  annotations: {
    readOnlyHint: false,
  },
})
export default class ForgetTool extends ToolContext {
  async execute(input: ForgetInput): Promise<ForgetOutput> {
    const remember = this.get(RememberAccessorToken);
    const config = this.get(RememberConfigToken);

    // Validate scope is allowed for tools
    const scope = input.scope ?? 'session';
    const allowedScopes = config.tools?.allowedScopes ?? ['session', 'user', 'tool', 'global'];

    if (!allowedScopes.includes(scope)) {
      throw this.fail(new Error(`Scope '${scope}' is not allowed. Allowed scopes: ${allowedScopes.join(', ')}`));
    }

    // Check if key exists before deleting
    const existed = await remember.knows(input.key, { scope });

    // Delete the key
    await remember.forget(input.key, { scope });

    return {
      success: true,
      key: input.key,
      scope,
      existed,
    };
  }
}
