import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';

/**
 * Input schema for the list_memories tool.
 */
export const listMemoriesInputSchema = z.object({
  scope: z
    .enum(['session', 'user', 'tool', 'global'])
    .optional()
    .describe('Which scope to list from (default: session)'),
  pattern: z.string().optional().describe('Pattern to filter keys (e.g., "user_*")'),
  limit: z.number().positive().max(100).optional().describe('Maximum number of keys to return (default: 50)'),
});

/**
 * Output schema for the list_memories tool.
 */
export const listMemoriesOutputSchema = z.object({
  keys: z.array(z.string()),
  scope: z.string(),
  count: z.number(),
  truncated: z.boolean(),
});

export type ListMemoriesInput = z.infer<typeof listMemoriesInputSchema>;

export type ListMemoriesOutput = z.infer<typeof listMemoriesOutputSchema>;

/**
 * Tool to list all remembered keys in a scope.
 */
@Tool({
  name: 'list_memories',
  description:
    'List all remembered keys in a scope. ' +
    'Use this to see what memories are stored for the current session or user.',
  inputSchema: listMemoriesInputSchema,
  outputSchema: listMemoriesOutputSchema,
  annotations: {
    readOnlyHint: true,
  },
})
export default class ListMemoriesTool extends ToolContext {
  async execute(input: ListMemoriesInput): Promise<ListMemoriesOutput> {
    const remember = this.get(RememberAccessorToken);
    const config = this.get(RememberConfigToken);

    // Validate scope is allowed for tools
    const scope = input.scope ?? 'session';
    const allowedScopes = config.tools?.allowedScopes ?? ['session', 'user', 'tool', 'global'];

    if (!allowedScopes.includes(scope)) {
      throw this.fail(new Error(`Scope '${scope}' is not allowed. Allowed scopes: ${allowedScopes.join(', ')}`));
    }

    const limit = input.limit ?? 50;

    // Get all keys matching the pattern
    let keys = await remember.list({ scope, pattern: input.pattern });

    // Check if we need to truncate
    const truncated = keys.length > limit;
    if (truncated) {
      keys = keys.slice(0, limit);
    }

    return {
      keys,
      scope,
      count: keys.length,
      truncated,
    };
  }
}
