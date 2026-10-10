/**
 * FrontMcpContextStorage - AsyncLocalStorage wrapper for unified context
 *
 * Provides concurrent-safe context propagation using Node.js AsyncLocalStorage.
 * Access through DI only - never use static imports to access the storage directly.
 *
 * @example
 * ```typescript
 * // In a flow or middleware
 * const storage = this.get(FrontMcpContextStorage);
 * await storage.runFromHeaders(request.headers, {
 *   sessionId: sessionId,
 *   scopeId: scope.id,
 * }, async () => {
 *   // All code here can access the context via DI
 *   const ctx = this.get(FRONTMCP_CONTEXT);
 * });
 * ```
 */

import { type AuthInfo } from '@frontmcp/protocol';
import { AsyncLocalStorage, randomUUID } from '@frontmcp/utils';

import { Provider } from '../common/decorators';
import { ProviderScope } from '../common/metadata';
import { ServerRequestTokens } from '../common/tokens';
import { RequestContextNotAvailableError } from '../errors/mcp.error';
import { FrontMcpContext, type FrontMcpContextArgs, type FrontMcpContextConfig } from './frontmcp-context';
import { extractMetadata, type ClientIpOptions } from './metadata.utils';
import { parseTraceContext } from './trace-context';

/**
 * Module-level AsyncLocalStorage instance.
 *
 * This is the ONLY place where the storage is created.
 * Access should be through DI, not through static imports.
 */
const frontmcpContextStorage = new AsyncLocalStorage<FrontMcpContext>();

/**
 * The bindings object (a Cloudflare Worker's `env`) of a request: `context`'s, else that of the
 * request the calling code runs in. `undefined` when the request carries none (Node, stdio, a
 * direct call given no `workerEnv`). Code built outside a flow's providers, such as a job run by
 * `execute_job`, still runs inside the request that started it, so it reads that request's
 * bindings (#678).
 */
export function workerEnvOf(context: FrontMcpContext | undefined): Readonly<Record<string, unknown>> | undefined {
  const env = (context ?? frontmcpContextStorage.getStore())?.platformEnv;
  return env !== null && typeof env === 'object' ? (env as Readonly<Record<string, unknown>>) : undefined;
}

/**
 * FrontMcpContextStorage provides unified context via AsyncLocalStorage.
 *
 * This is a GLOBAL-scoped provider because it manages the storage itself,
 * not the per-context data. The actual FrontMcpContext is accessed via
 * the FRONTMCP_CONTEXT token which is CONTEXT-scoped.
 */
@Provider({
  name: 'FrontMcpContextStorage',
  description: 'Manages unified context via AsyncLocalStorage',
  scope: ProviderScope.GLOBAL,
})
export class FrontMcpContextStorage {
  private contextConfig: FrontMcpContextConfig = {};
  private proxyTrust: Omit<ClientIpOptions, 'peerAddress'> = {};

  /**
   * Apply server-wide defaults (from `@FrontMcp({ fetch })`) to every context this storage creates.
   *
   * @param contextConfig - Defaults; a context's own config still overrides them
   * @param proxyTrust - Whether to read the client address from `X-Forwarded-For` (`throttle.ipFilter`)
   * @returns This storage
   */
  configure(contextConfig: FrontMcpContextConfig = {}, proxyTrust: Omit<ClientIpOptions, 'peerAddress'> = {}): this {
    this.contextConfig = contextConfig;
    this.proxyTrust = proxyTrust;
    return this;
  }

  /**
   * Run a callback with a new FrontMcpContext.
   *
   * @param args - Arguments to create the context
   * @param fn - Async function to run with the context
   * @returns Result of the callback
   */
  run<T>(args: FrontMcpContextArgs, fn: () => T | Promise<T>): T | Promise<T> {
    const context = new FrontMcpContext(this.withServerConfig(args));
    return frontmcpContextStorage.run(context, fn);
  }

  /**
   * Run with context extracted from HTTP headers.
   *
   * Automatically parses trace context from headers using W3C Trace Context
   * specification with fallback to x-frontmcp-trace-id.
   *
   * @param headers - HTTP headers
   * @param args - Additional context args (sessionId, scopeId)
   * @param fn - Async function to run
   * @returns Result of the callback
   */
  runFromHeaders<T>(
    headers: Record<string, unknown>,
    args: Omit<FrontMcpContextArgs, 'traceContext' | 'metadata'> & { peerAddress?: string },
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    const { peerAddress, ...contextArgs } = args;
    const traceContext = parseTraceContext(headers);
    // The socket peer is the only client address a caller cannot forge; forwarding headers
    // are used in its place only behind a trusted proxy (GHSA-p3qf-fcwm-35x4).
    const metadata = extractMetadata(headers, { ...this.proxyTrust, peerAddress });
    const context = new FrontMcpContext(
      this.withServerConfig({
        ...contextArgs,
        traceContext,
        metadata,
      }),
    );
    return frontmcpContextStorage.run(context, fn);
  }

  /**
   * Run with the context of an incoming HTTP request: its `mcp-session-id` (a fresh anonymous
   * id when it sends none), its trace context and metadata, and the socket peer when the
   * runtime exposes one. Every adapter enters its flows through this, so they all see the
   * same context for the same request.
   *
   * @param request - The request's headers, and its socket where the runtime has one
   * @param scopeId - Scope handling the request
   * @param fn - Async function to run
   * @returns Result of the callback
   */
  runForHttpRequest<T>(
    request: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } },
    scopeId: string,
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    const headers = request.headers ?? {};
    const headerSessionId = typeof headers['mcp-session-id'] === 'string' ? headers['mcp-session-id'].trim() : '';
    const sessionId = headerSessionId.length > 0 ? headerSessionId : `anon:${randomUUID()}`;
    // The web-fetch adapter carries the Worker's bindings on the request (ServerRequestTokens.webEnv).
    const platformEnv = (request as Record<PropertyKey, unknown>)[ServerRequestTokens.webEnv];
    return this.runFromHeaders(
      headers,
      { sessionId, scopeId, peerAddress: request.socket?.remoteAddress, platformEnv },
      fn,
    );
  }

  private withServerConfig(args: FrontMcpContextArgs): FrontMcpContextArgs {
    return { ...args, config: { ...this.contextConfig, ...args.config } };
  }

  /**
   * Run with an existing FrontMcpContext.
   *
   * Useful when you need to propagate an existing context to a new async scope.
   *
   * @param context - Existing FrontMcpContext
   * @param fn - Async function to run
   * @returns Result of the callback
   */
  runWithContext<T>(context: FrontMcpContext, fn: () => T | Promise<T>): T | Promise<T> {
    return frontmcpContextStorage.run(context, fn);
  }

  /**
   * Get the current FrontMcpContext.
   *
   * @returns Current context or undefined if not in a context scope
   */
  getStore(): FrontMcpContext | undefined {
    return frontmcpContextStorage.getStore();
  }

  /**
   * Get the current FrontMcpContext, throwing if not available.
   *
   * @throws Error if not in a context scope
   */
  getStoreOrThrow(): FrontMcpContext {
    const ctx = this.getStore();
    if (!ctx) {
      throw new RequestContextNotAvailableError(
        'FrontMcpContext not available. Ensure operation runs within context scope.',
      );
    }
    return ctx;
  }

  /**
   * Check if currently running within a context.
   *
   * @returns True if a FrontMcpContext is available
   */
  hasContext(): boolean {
    return frontmcpContextStorage.getStore() !== undefined;
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
  updateAuthInfo<T>(authInfo: Partial<AuthInfo>, fn: () => T | Promise<T>): T | Promise<T> {
    const current = this.getStoreOrThrow();
    current.updateAuthInfo(authInfo);
    return fn();
  }
}
