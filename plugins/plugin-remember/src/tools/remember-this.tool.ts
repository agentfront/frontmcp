import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';
import { REMEMBER_SCOPE_DESCRIPTION } from './remember-scope.description';

/**
 * Input schema for the remember_this tool.
 */
export const rememberThisInputSchema = {
  key: z.string().min(1).describe('What to call this memory (e.g., "user_preference", "last_action")'),
  value: z.unknown().describe('The value to remember (any JSON-serializable data)'),
  scope: z.enum(['session', 'user', 'tool', 'global']).optional().describe(REMEMBER_SCOPE_DESCRIPTION),
  ttl: z.number().positive().optional().describe('Forget after this many seconds'),
  brand: z
    .enum(['preference', 'cache', 'state', 'conversation', 'custom'])
    .optional()
    .describe('Type hint for the stored value'),
};

/**
 * Output schema for the remember_this tool.
 */
export const rememberThisOutputSchema = z.object({
  success: z.boolean(),
  key: z.string(),
  scope: z.string(),
  expiresAt: z.number().optional(),
});

export type RememberThisInput = z.infer<z.ZodObject<typeof rememberThisInputSchema>>;

export type RememberThisOutput = z.infer<typeof rememberThisOutputSchema>;

/**
 * Tool to store a value in memory.
 * Enables LLM to remember things for later use.
 */
@Tool({
  name: 'remember_this',
  description:
    'Remember something for later: store a value under a key that recall can read back, in the scope you choose ' +
    '(this session by default; user scope for the signed-in user across sessions). It lasts until it is forgotten ' +
    'or its ttl runs out. ' +
    'Use this when the user asks you to remember preferences, settings, or any information they want to persist.',
  inputSchema: rememberThisInputSchema,
  outputSchema: rememberThisOutputSchema,
  annotations: {
    readOnlyHint: false,
  },
})
export default class RememberThisTool extends ToolContext {
  async execute(input: RememberThisInput): Promise<RememberThisOutput> {
    const remember = this.get(RememberAccessorToken);
    const config = this.get(RememberConfigToken);

    // Validate scope is allowed for tools
    const scope = input.scope ?? 'session';
    const allowedScopes = config.tools?.allowedScopes ?? ['session', 'user', 'tool', 'global'];

    if (!allowedScopes.includes(scope)) {
      throw this.fail(new Error(`Scope '${scope}' is not allowed. Allowed scopes: ${allowedScopes.join(', ')}`));
    }

    await remember.set(input.key, input.value, {
      scope,
      ttl: input.ttl,
      brand: input.brand,
    });

    const expiresAt = input.ttl ? Date.now() + input.ttl * 1000 : undefined;

    return {
      success: true,
      key: input.key,
      scope,
      expiresAt,
    };
  }
}
