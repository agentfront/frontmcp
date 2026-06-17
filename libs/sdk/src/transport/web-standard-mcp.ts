/**
 * MCP-over-web-standard-transport adapter used by the `handleWebFetch` execute
 * stage of the `http:request` flow (V8 isolates / Cloudflare Workers).
 *
 * Two modes, both speaking the SAME `WebStandardStreamableHTTPServerTransport`:
 *
 * - **Stateless** ({@link runWebStandardMcp} with no `persistent`): a fresh
 *   `McpServer` + transport per request (`sessionIdGenerator: undefined`). The
 *   default serverless model.
 * - **Stateful** (a Durable Object passes `persistent`): one persistent
 *   `McpServer` + session-bound transport built once via {@link
 *   buildPersistentWebStandardMcp} and reused across the session's requests, so
 *   the standalone GET notification stream stays open and a `tools/call`'s
 *   notifications reach it. The DO owns the lifecycle — no per-request teardown.
 *
 * Auth / quota / router / audit / metrics + hooks have already run in the flow
 * around this call; this only translates the MCP request↔response.
 */
import { type AuthInfo } from '@frontmcp/protocol';
import { randomUUID } from '@frontmcp/utils';

import { type Scope } from '../scope/scope.instance';
import { buildScopedServerOptions, type ScopedServerOptions } from './build-scoped-server-options';

/** A persistent MCP server + transport bound to one session (Durable Object). */
export interface WebStandardMcpPair {
  mcpServer: { close(): Promise<void> };
  transport: {
    handleRequest(request: Request, options?: { authInfo?: AuthInfo }): Promise<Response>;
    onclose?: () => void;
  };
}

export interface RunWebStandardMcpOptions {
  /** Capability/server options for the `McpServer` (from `buildScopedServerOptions`). */
  serverOptions: ScopedServerOptions;
  /** Verified auth info to expose to handlers (derived from the flow's session:verify result). */
  authInfo?: Partial<AuthInfo>;
  /** Allow SSE streaming responses on POST when the client accepts `text/event-stream` (stateless mode). */
  sse: boolean;
  /** Worker `ExecutionContext` so an SSE body can keep the isolate alive past `fetch` (stateless mode). */
  ctx?: { waitUntil?(promise: Promise<unknown>): void };
  /**
   * A persistent, session-bound server+transport (Durable Object / stateful
   * sessions). When provided, the request is handled on it and no fresh server
   * is created or torn down — the DO owns its lifecycle.
   */
  persistent?: WebStandardMcpPair;
}

/** Wire scope handlers onto a fresh `McpServer` + transport and connect them. */
async function wireServer(
  scope: Scope,
  serverOptions: ScopedServerOptions,
  sessionId: string,
  sessionIdGenerator: (() => string) | undefined,
  enableJsonResponse: boolean,
): Promise<WebStandardMcpPair> {
  const { McpServer, WebStandardStreamableHTTPServerTransport } = await import('@frontmcp/protocol');
  const { createMcpHandlers } = await import('./mcp-handlers/index.js');

  const mcpServer = new McpServer(scope.metadata.info, serverOptions);
  for (const handler of createMcpHandlers({ scope, serverOptions })) {
    const originalHandler = handler.handler;
    const wrappedHandler = async (req: unknown, ctx: Record<string, unknown>): Promise<unknown> => {
      // Per-request auth comes from the transport's `handleRequest({ authInfo })`
      // (the flow's verified authorization). Carry the session id alongside it.
      const existingAuthInfo = (ctx?.['authInfo'] as Record<string, unknown> | undefined) ?? {};
      const enrichedCtx = { ...ctx, authInfo: { ...existingAuthInfo, sessionId } };
      return originalHandler(req as never, enrichedCtx as never);
    };
    mcpServer.setRequestHandler(handler.requestSchema, wrappedHandler as never);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator, enableJsonResponse });
  await mcpServer.connect(transport);
  return { mcpServer, transport } as unknown as WebStandardMcpPair;
}

/**
 * Build a persistent, session-bound MCP server + transport for a Durable Object.
 * Stateful (`sessionIdGenerator: () => sessionId`) and streaming-capable
 * (`enableJsonResponse: false`) so the standalone GET notification stream and
 * server-initiated notifications work. Call once per session; the DO keeps it
 * alive and passes it back via `RunWebStandardMcpOptions.persistent`.
 */
export async function buildPersistentWebStandardMcp(
  scope: Scope,
  options: { sessionId: string },
): Promise<WebStandardMcpPair> {
  const serverOptions = buildScopedServerOptions(scope);
  return wireServer(scope, serverOptions, options.sessionId, () => options.sessionId, false);
}

export async function runWebStandardMcp(
  scope: Scope,
  request: Request,
  options: RunWebStandardMcpOptions,
): Promise<Response> {
  // Stateful mode — handle on the Durable Object's persistent transport. No
  // build, no teardown: the DO owns the server's lifecycle.
  if (options.persistent) {
    return options.persistent.transport.handleRequest(request, { authInfo: options.authInfo as AuthInfo | undefined });
  }

  // Stateless mode — fresh server + transport for this one request.
  const sessionId = `web:${randomUUID()}`;
  // A GET opens the server→client SSE stream; a POST may stream SSE when allowed
  // AND the client accepts text/event-stream. Otherwise the POST is buffered JSON.
  const accept = request.headers.get('accept') ?? '';
  const wantsStream = request.method === 'GET' || (options.sse && accept.includes('text/event-stream'));

  const { mcpServer, transport } = await wireServer(
    scope,
    options.serverOptions,
    sessionId,
    undefined,
    !wantsStream,
  );
  const response = await transport.handleRequest(request, {
    authInfo: options.authInfo as AuthInfo | undefined,
  });

  // SSE bodies keep producing after this returns — keep the server alive until
  // the transport closes (held open via `ctx.waitUntil`). Buffered JSON is fully
  // materialized, so close right away.
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const closed = new Promise<void>((resolve) => {
      const prev = transport.onclose;
      transport.onclose = () => {
        prev?.();
        resolve();
      };
    });
    const teardown = closed.then(() => mcpServer.close().catch(() => undefined));
    if (options.ctx?.waitUntil) options.ctx.waitUntil(teardown);
    else void teardown;
  } else {
    void mcpServer.close().catch(() => undefined);
  }

  return response;
}
