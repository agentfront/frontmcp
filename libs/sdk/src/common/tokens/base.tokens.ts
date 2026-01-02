import { createTokenFactory } from '@frontmcp/di';

export const baseTokenPrefix = 'FrontMcp';

/**
 * Token factory for FrontMCP-specific tokens.
 * Uses the DI library's createTokenFactory with FrontMcp prefix.
 */
export const tokenFactory = createTokenFactory({ prefix: baseTokenPrefix });
