// file: libs/sdk/src/server/adapters/noop.host.adapter.ts
/**
 * NoOp Host Adapter for browser environments.
 *
 * This adapter implements the HostServerAdapter interface with no-op methods
 * since browsers don't need an HTTP server. Browser MCP servers use event-based
 * transport (EventEmitter, postMessage) instead of HTTP.
 *
 * @example
 * ```typescript
 * import { NoOpHostAdapter } from '@frontmcp/sdk/core';
 *
 * // Use in browser MCP server configuration
 * const server = new BrowserMcpServer({
 *   hostAdapter: new NoOpHostAdapter(),
 *   transport: new EventTransportAdapter(emitter),
 * });
 * ```
 */

import { HostServerAdapter } from './base.host.adapter';
import { HttpMethod, ServerRequestHandler } from '../../common';

/**
 * NoOp host adapter for browser environments.
 *
 * All methods are no-ops since browser MCP servers don't run an HTTP server.
 * Transport is handled via EventEmitter or postMessage instead.
 */
export class NoOpHostAdapter extends HostServerAdapter {
  private middlewares: Map<string, ServerRequestHandler[]> = new Map();
  private routes: Map<string, Map<HttpMethod, ServerRequestHandler>> = new Map();
  private prepared = false;

  /**
   * Register a middleware handler (no-op in browser, stores for reference)
   */
  registerMiddleware(entryPath: string, handler: ServerRequestHandler): void {
    if (!this.middlewares.has(entryPath)) {
      this.middlewares.set(entryPath, []);
    }
    this.middlewares.get(entryPath)!.push(handler);
  }

  /**
   * Register a route handler (no-op in browser, stores for reference)
   */
  registerRoute(method: HttpMethod, path: string, handler: ServerRequestHandler): void {
    if (!this.routes.has(path)) {
      this.routes.set(path, new Map());
    }
    this.routes.get(path)!.set(method, handler);
  }

  /**
   * Enhanced handler wrapper (returns handler as-is in browser)
   */
  enhancedHandler(handler: ServerRequestHandler): ServerRequestHandler {
    return handler;
  }

  /**
   * Prepare server routes (no-op in browser)
   */
  prepare(): void {
    this.prepared = true;
  }

  /**
   * Get underlying HTTP handler (returns null in browser - no HTTP server)
   */
  getHandler(): null {
    return null;
  }

  /**
   * Start server (no-op in browser - no HTTP server to start)
   */
  start(_port?: number): void {
    // No-op: Browser doesn't have an HTTP server to start
    // Transport is handled by EventTransport or PostMessageTransport
  }

  /**
   * Check if the adapter has been prepared
   */
  isPrepared(): boolean {
    return this.prepared;
  }

  /**
   * Get registered middleware (for debugging/testing)
   */
  getMiddlewares(): Map<string, ServerRequestHandler[]> {
    return new Map(this.middlewares);
  }

  /**
   * Get registered routes (for debugging/testing)
   */
  getRoutes(): Map<string, Map<HttpMethod, ServerRequestHandler>> {
    return new Map(this.routes);
  }
}
