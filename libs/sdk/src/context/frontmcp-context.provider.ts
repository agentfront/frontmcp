/**
 * FRONTMCP_CONTEXT Provider
 *
 * Defines the DI token and factory provider for accessing FrontMcpContext.
 * The context is retrieved from AsyncLocalStorage via FrontMcpContextStorage.
 */

import { ProviderScope } from '../common/metadata';
import { ProviderFactoryType } from '../common/interfaces/provider.interface';
import { FrontMcpContext } from './frontmcp-context';
import { FrontMcpContextStorage } from './frontmcp-context-storage';

/**
 * DI token for accessing the current FrontMcpContext.
 *
 * Use this token to inject the current context in any provider or context:
 *
 * @example
 * ```typescript
 * // In a tool/resource/prompt
 * const ctx = this.get(FRONTMCP_CONTEXT);
 * console.log(ctx.requestId, ctx.sessionId, ctx.authInfo);
 *
 * // Access transport for elicit
 * const result = await ctx.transport?.elicit('Choose an option', schema);
 *
 * // Context-aware fetch
 * const response = await ctx.fetch('https://api.example.com/data');
 * ```
 */
export const FRONTMCP_CONTEXT = Symbol.for('frontmcp:CONTEXT');

/**
 * @deprecated Use FRONTMCP_CONTEXT instead
 */
export const REQUEST_CONTEXT = FRONTMCP_CONTEXT;

/**
 * Factory provider for FrontMcpContext.
 *
 * This provider is marked as CONTEXT scope and retrieves the current
 * FrontMcpContext from AsyncLocalStorage via FrontMcpContextStorage.
 *
 * Note: This provider will throw if called outside of a context scope
 * (i.e., without first calling FrontMcpContextStorage.run or runFromHeaders).
 */
export const FrontMcpContextProvider: ProviderFactoryType<FrontMcpContext, readonly [typeof FrontMcpContextStorage]> = {
  provide: FRONTMCP_CONTEXT,
  inject: () => [FrontMcpContextStorage] as const,
  useFactory: (storage: FrontMcpContextStorage): FrontMcpContext => {
    return storage.getStoreOrThrow();
  },
  metadata: {
    name: 'FrontMcpContext',
    description: 'Current unified context from AsyncLocalStorage',
    scope: ProviderScope.CONTEXT,
  },
} as any; // Type assertion needed due to ProviderFactoryType limitations

/**
 * @deprecated Use FrontMcpContextProvider instead
 */
export const RequestContextProvider = FrontMcpContextProvider;
