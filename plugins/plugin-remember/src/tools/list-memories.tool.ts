import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { RememberScopeNotAllowedError } from '../remember.errors';
import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';
import { REMEMBER_SCOPE_DESCRIPTION } from './remember-scope.description';
import { rememberToolNames, type RememberToolNames } from './remember-tool-names';

/**
 * Input schema for the list_memories tool.
 */
export const listMemoriesInputSchema = {
  scope: z.enum(['session', 'user', 'tool', 'global']).optional().describe(REMEMBER_SCOPE_DESCRIPTION),
  pattern: z.string().optional().describe('Pattern to filter keys (e.g., "user_*")'),
  limit: z.number().positive().max(100).optional().describe('Maximum number of keys to return (default: 50)'),
};

/**
 * Output schema for the list_memories tool.
 */
export const listMemoriesOutputSchema = z.object({
  keys: z.array(z.string()),
  scope: z.string(),
  count: z.number(),
  truncated: z.boolean(),
});

export type ListMemoriesInput = z.infer<z.ZodObject<typeof listMemoriesInputSchema>>;

export type ListMemoriesOutput = z.infer<typeof listMemoriesOutputSchema>;

export function listMemoriesDescription(names: RememberToolNames = rememberToolNames()): string {
  return (
    'List the remembered keys in one scope (default: session). ' +
    `Use this to see what memories are stored before you ${names.recall} or ${names.forget} one.`
  );
}

export function listMemoriesToolMetadata(names: RememberToolNames = rememberToolNames()) {
  return {
    name: names.listMemories,
    description: listMemoriesDescription(names),
    inputSchema: listMemoriesInputSchema,
    outputSchema: listMemoriesOutputSchema,
    annotations: { readOnlyHint: true },
  };
}

/**
 * Tool to list all remembered keys in a scope.
 */
@Tool(listMemoriesToolMetadata())
export default class ListMemoriesTool extends ToolContext {
  async execute(input: ListMemoriesInput): Promise<ListMemoriesOutput> {
    const remember = this.get(RememberAccessorToken);
    const config = this.get(RememberConfigToken);

    // Validate scope is allowed for tools
    const scope = input.scope ?? 'session';
    const allowedScopes = config.tools?.allowedScopes ?? ['session', 'user', 'tool', 'global'];

    if (!allowedScopes.includes(scope)) {
      throw this.fail(new RememberScopeNotAllowedError(scope, allowedScopes));
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
