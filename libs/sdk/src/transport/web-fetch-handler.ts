/**
 * Web-standard `fetch` handler for FrontMCP.
 *
 * Routes a Web `Request` straight into the MCP SDK's
 * `WebStandardStreamableHTTPServerTransport` (Request/Response/ReadableStream) —
 * no Express, no Node `req`/`res` shim. This is the correct runtime for V8
 * isolates (Cloudflare Workers, Deno Deploy, Bun) where Node `http` objects
 * don't exist, and it avoids the fragile Web→Node→Web double conversion the
 * old Cloudflare entry template performed.
 *
 * Stateless by design: each request gets a fresh `McpServer` + transport
 * (`sessionIdGenerator: undefined`), matching the serverless execution model.
 * FrontMCP's full request pipeline (tool/resource/prompt flows, hooks) is
 * preserved because the handlers come from `createMcpHandlers(scope)` — the
 * same handlers the stdio and in-memory transports use.
 */
import { type AuthInfo } from '@frontmcp/protocol';
import { randomUUID } from '@frontmcp/utils';

import { type Scope } from '../scope/scope.instance';
import { buildScopedServerOptions } from './build-scoped-server-options';

/** A Web-standard fetch handler: `(request) => Promise<Response>`. */
export type WebFetchHandler = (request: Request) => Promise<Response>;

export interface CreateWebFetchHandlerOptions {
  /**
   * Auth info injected on every MCP request. The Worker target's auth gate is
   * a follow-up (v1.3 managed auth); for now this is a static context.
   */
  authInfo?: Partial<AuthInfo>;
  /**
   * Paths answered with a liveness/readiness 200 instead of being routed to
   * the MCP transport. Defaults to `/healthz` and `/readyz`.
   */
  healthPaths?: string[];
}

/**
 * Build a Web-standard fetch handler for a Scope.
 *
 * @example
 * ```ts
 * const handler = createWebFetchHandler(scope);
 * export default { fetch: (request) => handler(request) };
 * ```
 */
export function createWebFetchHandler(scope: Scope, options: CreateWebFetchHandlerOptions = {}): WebFetchHandler {
  const healthPaths = new Set(options.healthPaths ?? ['/healthz', '/readyz']);
  const serverOptions = buildScopedServerOptions(scope);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Liveness/readiness — cheap, no MCP server spin-up.
    if (healthPaths.has(url.pathname)) {
      return Response.json(
        { status: 'ok', server: scope.metadata.info, transport: 'web-fetch' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Lazy-load protocol bindings so non-worker bundles don't eagerly pull the
    // transport, and so this module stays import-safe in browser builds.
    const { McpServer, WebStandardStreamableHTTPServerTransport } = await import('@frontmcp/protocol');
    const { createMcpHandlers } = await import('./mcp-handlers/index.js');

    const sessionId = `web:${randomUUID()}`;
    const mcpServer = new McpServer(scope.metadata.info, serverOptions);

    const handlers = createMcpHandlers({ scope, serverOptions });
    for (const handler of handlers) {
      const originalHandler = handler.handler;
      const wrappedHandler = async (req: unknown, ctx: Record<string, unknown>): Promise<unknown> => {
        const existingAuthInfo = (ctx?.['authInfo'] as Record<string, unknown> | undefined) ?? {};
        const enrichedCtx = {
          ...ctx,
          authInfo: { ...options.authInfo, ...existingAuthInfo, sessionId },
        };
        return originalHandler(req as never, enrichedCtx as never);
      };
      mcpServer.setRequestHandler(handler.requestSchema, wrappedHandler as never);
    }

    // Stateless: a fresh transport per request, JSON responses (no SSE stream)
    // so the body is fully buffered and the server can be torn down once the
    // Response is produced.
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await mcpServer.connect(transport);
    try {
      return await transport.handleRequest(request, { authInfo: options.authInfo as AuthInfo | undefined });
    } finally {
      // enableJsonResponse buffers the body into the returned Response, so it
      // is safe to tear down the per-request server/transport here.
      void mcpServer.close().catch(() => undefined);
    }
  };
}
