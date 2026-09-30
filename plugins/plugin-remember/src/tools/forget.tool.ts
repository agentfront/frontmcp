import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';
import { REMEMBER_SCOPE_DESCRIPTION } from './remember-scope.description';
import { rememberToolNames, type RememberToolNames } from './remember-tool-names';

/**
 * Input schema for the forget tool.
 */
export const forgetInputSchema = {
  key: z.string().min(1).describe('What memory to forget'),
  scope: z.enum(['session', 'user', 'tool', 'global']).optional().describe(REMEMBER_SCOPE_DESCRIPTION),
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

export type ForgetInput = z.infer<z.ZodObject<typeof forgetInputSchema>>;

export type ForgetOutput = z.infer<typeof forgetOutputSchema>;

export function forgetDescription(): string {
  return (
    'Forget a previously remembered value. ' +
    'Use this when the user wants to delete stored preferences or information.'
  );
}

export function forgetToolMetadata(names: RememberToolNames = rememberToolNames()) {
  return {
    name: names.forget,
    description: forgetDescription(),
    inputSchema: forgetInputSchema,
    outputSchema: forgetOutputSchema,
    annotations: { readOnlyHint: false },
  };
}

/**
 * Tool to forget a previously remembered value.
 */
@Tool(forgetToolMetadata())
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
