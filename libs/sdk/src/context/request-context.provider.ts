/**
 * REQUEST_CONTEXT Provider
 *
 * Defines the DI token and factory provider for accessing RequestContext.
 * The context is retrieved from AsyncLocalStorage via RequestContextStorage.
 */

import { ProviderScope } from '../common/metadata';
import { ProviderFactoryType } from '../common/interfaces/provider.interface';
import { RequestContext } from './request-context';
import { RequestContextStorage } from './request-context-storage';

/**
 * DI token for accessing the current RequestContext.
 *
 * Use this token to inject the current request context in any provider or context:
 *
 * @example
 * ```typescript
 * // In a tool/resource/prompt
 * const ctx = this.get(REQUEST_CONTEXT);
 * console.log(ctx.requestId, ctx.traceContext.traceId);
 *
 * // In a provider with constructor injection
 * constructor(
 *   @Inject(REQUEST_CONTEXT) private ctx: RequestContext
 * ) {}
 * ```
 */
export const REQUEST_CONTEXT = Symbol.for('frontmcp:REQUEST_CONTEXT');

/**
 * Factory provider for RequestContext.
 *
 * This provider is marked as REQUEST scope and retrieves the current
 * RequestContext from AsyncLocalStorage via RequestContextStorage.
 *
 * Note: This provider will throw if called outside of a request scope
 * (i.e., without first calling RequestContextStorage.run or runFromHeaders).
 */
export const RequestContextProvider: ProviderFactoryType<RequestContext, readonly [typeof RequestContextStorage]> = {
  provide: REQUEST_CONTEXT,
  inject: () => [RequestContextStorage] as const,
  useFactory: (storage: RequestContextStorage): RequestContext => {
    return storage.getStoreOrThrow();
  },
  metadata: {
    name: 'RequestContext',
    description: 'Current request context from AsyncLocalStorage',
    scope: ProviderScope.REQUEST,
  },
} as any;
