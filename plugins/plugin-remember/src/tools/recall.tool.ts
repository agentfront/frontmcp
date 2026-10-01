import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { RememberScopeNotAllowedError } from '../remember.errors';
import { RememberAccessorToken, RememberConfigToken } from '../remember.symbols';
import type { RememberScope } from '../remember.types';
import { REMEMBER_SCOPE_DESCRIPTION } from './remember-scope.description';
import { rememberToolNames, type RememberToolNames } from './remember-tool-names';

/**
 * Input schema for the recall tool.
 */
export const recallInputSchema = {
  key: z.string().min(1).describe('What memory to recall'),
  scope: z.enum(['session', 'user', 'tool', 'global']).optional().describe(REMEMBER_SCOPE_DESCRIPTION),
};

/**
 * Output schema for the recall tool.
 */
export const recallOutputSchema = z.object({
  found: z.boolean(),
  key: z.string(),
  value: z.unknown().optional(),
  scope: z.string(),
  createdAt: z.number().optional(),
  expiresAt: z.number().optional(),
});

export type RecallInput = {
  key: string;
  scope?: RememberScope;
};

export type RecallOutput = z.infer<typeof recallOutputSchema>;

export function recallDescription(names: RememberToolNames = rememberToolNames()): string {
  return (
    'Recall something that was previously remembered. ' +
    `Use this to retrieve stored preferences, settings, or any information that was saved with ${names.rememberThis}.`
  );
}

export function recallToolMetadata(names: RememberToolNames = rememberToolNames()) {
  return {
    name: names.recall,
    description: recallDescription(names),
    inputSchema: recallInputSchema,
    outputSchema: recallOutputSchema,
    annotations: { readOnlyHint: true },
  };
}

/**
 * Tool to recall a previously remembered value.
 */
@Tool(recallToolMetadata())
export default class RecallTool extends ToolContext {
  async execute(input: RecallInput): Promise<RecallOutput> {
    const remember = this.get(RememberAccessorToken);
    const config = this.get(RememberConfigToken);

    // Validate scope is allowed for tools
    const scope = input.scope ?? 'session';
    const allowedScopes = config.tools?.allowedScopes ?? ['session', 'user', 'tool', 'global'];

    if (!allowedScopes.includes(scope)) {
      throw this.fail(new RememberScopeNotAllowedError(scope, allowedScopes));
    }

    // Get full entry with metadata
    const entry = await remember.getEntry(input.key, { scope });

    if (!entry) {
      return {
        found: false,
        key: input.key,
        scope,
      };
    }

    return {
      found: true,
      key: input.key,
      value: entry.value,
      scope,
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
    };
  }
}
