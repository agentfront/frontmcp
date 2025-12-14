/**
 * RequestContextStorage - AsyncLocalStorage wrapper for request-scoped context
 *
 * Provides concurrent-safe request context propagation using Node.js AsyncLocalStorage.
 * Access through DI only - never use static imports to access the storage directly.
 *
 * @example
 * ```typescript
 * // In a flow or middleware
 * const storage = this.get(RequestContextStorage);
 * await storage.runFromHeaders(request.headers, {
 *   sessionId: sessionId,
 *   authInfo: authInfo,
 *   scopeId: scope.id,
 * }, async () => {
 *   // All code here can access the context via DI
 *   const ctx = this.get(REQUEST_CONTEXT);
 * });
 * ```
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { Provider } from '../common/decorators';
import { ProviderScope } from '../common/metadata';
import { RequestContext, RequestContextArgs, RequestMetadata } from './request-context';
import { parseTraceContext } from './trace-context';

/**
 * Module-level AsyncLocalStorage instance.
 *
 * This is the ONLY place where the storage is created.
 * Access should be through DI, not through static imports.
 */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * RequestContextStorage provides request-scoped context via AsyncLocalStorage.
 *
 * This is a GLOBAL-scoped provider because it manages the storage itself,
 * not the per-request data. The actual RequestContext is accessed via
 * the REQUEST_CONTEXT token which is REQUEST-scoped.
 */
@Provider({
  name: 'RequestContextStorage',
  description: 'Manages request-scoped context via AsyncLocalStorage',
  scope: ProviderScope.GLOBAL,
})
export class RequestContextStorage {
  /**
   * Run a callback with a new RequestContext.
   *
   * @param args - Arguments to create the context
   * @param fn - Async function to run with the context
   * @returns Result of the callback
   */
  run<T>(args: RequestContextArgs, fn: () => T | Promise<T>): T | Promise<T> {
    const context = new RequestContext(args);
    return requestContextStorage.run(context, fn);
  }

  /**
   * Run with context extracted from HTTP headers.
   *
   * Automatically parses trace context from headers using W3C Trace Context
   * specification with fallback to x-frontmcp-trace-id.
   *
   * @param headers - HTTP headers
   * @param args - Additional context args (sessionId, authInfo, scopeId)
   * @param fn - Async function to run
   * @returns Result of the callback
   */
  runFromHeaders<T>(
    headers: Record<string, unknown>,
    args: Omit<RequestContextArgs, 'traceContext' | 'metadata'>,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    const traceContext = parseTraceContext(headers);
    const metadata = extractMetadata(headers);
    const context = new RequestContext({
      ...args,
      traceContext,
      metadata,
    });
    return requestContextStorage.run(context, fn);
  }

  /**
   * Run with an existing RequestContext.
   *
   * Useful when you need to propagate an existing context to a new async scope.
   *
   * @param context - Existing RequestContext
   * @param fn - Async function to run
   * @returns Result of the callback
   */
  runWithContext<T>(context: RequestContext, fn: () => T | Promise<T>): T | Promise<T> {
    return requestContextStorage.run(context, fn);
  }

  /**
   * Get the current RequestContext.
   *
   * @returns Current context or undefined if not in a request scope
   */
  getStore(): RequestContext | undefined {
    return requestContextStorage.getStore();
  }

  /**
   * Get the current RequestContext, throwing if not available.
   *
   * @throws Error if not in a request scope
   */
  getStoreOrThrow(): RequestContext {
    const ctx = this.getStore();
    if (!ctx) {
      throw new Error('RequestContext not available. Ensure operation runs within request scope.');
    }
    return ctx;
  }

  /**
   * Check if currently running within a request context.
   *
   * @returns True if a RequestContext is available
   */
  hasContext(): boolean {
    return requestContextStorage.getStore() !== undefined;
  }

  /**
   * Update the authInfo in the current context.
   *
   * This mutates the existing context in place to preserve internal state
   * (marks, store, sessionMetadata) while updating auth info.
   *
   * @param authInfo - Auth info fields to set/update (merged with existing)
   * @param fn - Function to run after update
   * @returns Result of the callback
   */
  updateAuthInfo<T>(authInfo: RequestContextArgs['authInfo'], fn: () => T | Promise<T>): T | Promise<T> {
    const current = this.getStoreOrThrow();
    // Mutate in place to preserve marks, store, and sessionMetadata
    current.updateAuthInfo(authInfo);
    return fn();
  }
}

/**
 * Extract request metadata from headers.
 */
function extractMetadata(headers: Record<string, unknown>): RequestMetadata {
  const customHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith('x-frontmcp-') && typeof value === 'string') {
      customHeaders[key.toLowerCase()] = value;
    }
  }

  return {
    userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : undefined,
    contentType: typeof headers['content-type'] === 'string' ? headers['content-type'] : undefined,
    accept: typeof headers['accept'] === 'string' ? headers['accept'] : undefined,
    clientIp: extractClientIp(headers),
    customHeaders,
  };
}

/**
 * Extract client IP from headers.
 * Handles both string and array header values (some adapters pass arrays).
 */
function extractClientIp(headers: Record<string, unknown>): string | undefined {
  // x-forwarded-for can be comma-separated list; first is client IP
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim();
  }
  // Some adapters pass arrays for multi-value headers
  if (Array.isArray(xff) && typeof xff[0] === 'string') {
    return xff[0].split(',')[0]?.trim();
  }

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }
  if (Array.isArray(realIp) && typeof realIp[0] === 'string') {
    return realIp[0];
  }

  return undefined;
}
