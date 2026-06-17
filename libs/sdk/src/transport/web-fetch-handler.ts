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

import { type CorsOptions } from '../common/types/options/http/interfaces';
import { expandProtocolConfig } from '../common/types/options/transport/schema';
import { normalizeEntryPrefix } from '../common/utils/path.utils';
import { type Scope } from '../scope/scope.instance';
import { buildScopedServerOptions } from './build-scoped-server-options';

/**
 * The host execution context — its `waitUntil` keeps the worker alive past the
 * `fetch` return so a streaming (SSE) response body can finish. Optional: in
 * Node there's no isolate teardown, so it's only needed on V8 isolates.
 */
export interface FetchHandlerCtx {
  waitUntil?(promise: Promise<unknown>): void;
}

/** A Web-standard fetch handler: `(request, ctx?) => Promise<Response>`. */
export type WebFetchHandler = (request: Request, ctx?: FetchHandlerCtx) => Promise<Response>;

/**
 * CORS for the web-fetch adapter — the transport-level analog of the Express
 * host's `cors` middleware (CORS is an adapter concern, not a flow stage), so a
 * browser MCP client (e.g. the MCP Inspector in "Direct" mode) can connect.
 */
export interface WebFetchCorsOptions {
  /** Allowed origin: `true` reflects the request `Origin`, `'*'` allows any, or a specific origin / list. */
  origin?: boolean | string | string[];
  /** Allowed methods. Default `GET, POST, OPTIONS, DELETE`. */
  methods?: string[];
  /** Allowed request headers. Default: reflect `Access-Control-Request-Headers`, else a sensible MCP set. */
  headers?: string[];
  /** Response headers exposed to the browser. Default `Mcp-Session-Id, WWW-Authenticate`. */
  exposeHeaders?: string[];
  /** Send `Access-Control-Allow-Credentials: true`. Default `false`. */
  credentials?: boolean;
  /** `Access-Control-Max-Age` (seconds) on the preflight response. */
  maxAge?: number;
}

/**
 * Map the scope's Express-style `http.cors` to the web-fetch adapter's CORS
 * options so a single `@FrontMcp({ http: { cors } })` config drives CORS on both
 * the Express host and the worker. A function `origin` (the Express `cors`-lib
 * callback) can't be replayed by the stateless web-fetch adapter, so it's left
 * disabled with a warning — use a static origin (`true` / string / `string[]`).
 */
function mapHttpCors(httpCors: CorsOptions | false | undefined, scope: Scope): WebFetchCorsOptions | undefined {
  if (!httpCors) return undefined; // `false` or unset → CORS off
  const { origin, credentials, maxAge } = httpCors;
  if (typeof origin === 'function') {
    scope.logger.warn(
      '[web-fetch] http.cors.origin is a function, which the worker adapter cannot replay — CORS left disabled. Use a static origin (true / string / string[]).',
    );
    return undefined;
  }
  return { origin, credentials, maxAge };
}

export interface CreateWebFetchHandlerOptions {
  /**
   * Auth info injected on every MCP request. The Worker target's auth gate is
   * a follow-up (v1.3 managed auth); for now this is a static context.
   */
  authInfo?: Partial<AuthInfo>;
  /**
   * Path the MCP endpoint (both Streamable HTTP `POST` and the SSE `GET`
   * stream) is served at. **Config-driven**: when omitted, it falls back to the
   * scope's `http.entryPath` (the same gateway prefix the Express host mounts
   * under), and to the worker root `/` when that too is unset. So one config
   * decides the path — set `http.entryPath: '/mcp'` for `<domain>/mcp`, or leave
   * it for `mcp.<domain>` at root. The worker serves exactly that one path.
   *
   * An explicit value here overrides the config. A trailing slash is normalized
   * (`/mcp/` matches `/mcp`). An array opts into a custom multi-path allow-list.
   * Requests to any other path (besides {@link
   * CreateWebFetchHandlerOptions.healthPaths}) get a 404.
   */
  entryPath?: string | string[];
  /**
   * Paths answered with a liveness/readiness 200 instead of being routed to
   * the MCP transport. Defaults to `/healthz` and `/readyz`.
   */
  healthPaths?: string[];
  /**
   * Allow **SSE streaming responses** on the MCP `POST` (Streamable HTTP
   * streaming mode) for clients that accept `text/event-stream` — instead of
   * always buffering JSON. The server is kept alive (via `ctx.waitUntil`) until
   * the stream closes. Server→client streams (the MCP `GET`) are always honored
   * regardless of this flag; it only governs whether POST responses may stream.
   *
   * **Config-driven**: when omitted, it's derived from the scope's transport
   * protocol — streaming is on when Streamable HTTP is enabled and JSON-only
   * buffering is off (true under the default `legacy`/`modern` presets, false
   * under `stateless-api`). An explicit value here overrides that.
   *
   * NOTE: session-correlated server push and the legacy `/sse` + `/message`
   * transport require a stateful session store (a Durable Object), which the
   * stateless web-fetch handler does not provide.
   */
  sse?: boolean;
  /**
   * CORS for browser MCP clients (Inspector "Direct" mode, web apps). A
   * transport-adapter concern, not a flow stage. **Config-driven**: when
   * omitted, it mirrors the scope's `http.cors` (the same config the Express
   * host uses), so `@FrontMcp({ http: { cors } })` covers both. An explicit
   * value here overrides that.
   */
  cors?: WebFetchCorsOptions;
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
  const httpConfig = scope.metadata.http;
  const healthPaths = new Set(options.healthPaths ?? ['/healthz', '/readyz']);
  // Normalize a path: ensure a leading slash, drop a trailing slash (keeping
  // root as `/`). So `/mcp`, `/mcp/`, and a configured `mcp` all compare equal.
  const normalizePath = (p: string): string => {
    const withSlash = p.startsWith('/') ? p : `/${p}`;
    const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
    return trimmed === '' ? '/' : trimmed;
  };
  // The single MCP endpoint path, driven by config: explicit option → scope's
  // `http.entryPath` (the Express gateway prefix) → worker root `/`. The worker
  // serves exactly where it's configured (not a guessed `/` + `/mcp` set); an
  // explicit array still opts into a multi-path allow-list.
  const rawEntry = options.entryPath ?? (normalizeEntryPrefix(httpConfig?.entryPath) || '/');
  const entryPaths = new Set((Array.isArray(rawEntry) ? rawEntry : [rawEntry]).map(normalizePath));
  // CORS: explicit option wins, else mirror the scope's `http.cors`.
  const cors = options.cors ?? mapHttpCors(httpConfig?.cors, scope);
  const corsEnabled = cors?.origin !== undefined && cors.origin !== false;
  // SSE streaming on POST: explicit option wins, else derived from the transport
  // protocol — stream when Streamable HTTP is on and JSON-only buffering is off.
  const proto = expandProtocolConfig(scope.metadata.transport?.protocol);
  const sseEnabled = options.sse ?? (proto.streamable && !proto.json);
  const serverOptions = buildScopedServerOptions(scope);

  /** CORS response headers for this request (empty when CORS is off / origin not allowed). */
  const corsHeadersFor = (request: Request): Record<string, string> => {
    if (!corsEnabled) return {};
    const reqOrigin = request.headers.get('origin') ?? '';
    let allowOrigin: string | undefined;
    if (cors!.origin === true) allowOrigin = reqOrigin || '*';
    else if (cors!.origin === '*' || cors!.origin === reqOrigin) allowOrigin = cors!.origin as string;
    else if (typeof cors!.origin === 'string') allowOrigin = cors!.origin;
    else if (Array.isArray(cors!.origin)) allowOrigin = cors!.origin.includes(reqOrigin) ? reqOrigin : undefined;
    if (!allowOrigin) return {};
    const h: Record<string, string> = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': (cors!.methods ?? ['GET', 'POST', 'OPTIONS', 'DELETE']).join(', '),
      'Access-Control-Allow-Headers': (
        cors!.headers ?? [
          request.headers.get('access-control-request-headers') ||
            'content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id',
        ]
      ).join(', '),
      'Access-Control-Expose-Headers': (cors!.exposeHeaders ?? ['Mcp-Session-Id', 'WWW-Authenticate']).join(', '),
    };
    if (cors!.credentials) h['Access-Control-Allow-Credentials'] = 'true';
    if (cors!.maxAge !== undefined) h['Access-Control-Max-Age'] = String(cors!.maxAge);
    if (allowOrigin !== '*') h['Vary'] = 'Origin';
    return h;
  };

  /** Reconstruct a Response with CORS headers merged in (preserves a streaming body). */
  const withCors = (response: Response, request: Request): Response => {
    if (!corsEnabled) return response;
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeadersFor(request))) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  return async function handle(request: Request, ctx?: FetchHandlerCtx): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight — answer OPTIONS directly (transport-adapter concern).
    if (corsEnabled && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeadersFor(request) });
    }

    // Liveness/readiness — cheap, no MCP server spin-up.
    if (healthPaths.has(url.pathname)) {
      return withCors(
        Response.json(
          { status: 'ok', server: scope.metadata.info, transport: 'web-fetch' },
          { headers: { 'Cache-Control': 'no-store' } },
        ),
        request,
      );
    }

    // MCP is served only at the configured entry path(s) (default: both `/`
    // and `/mcp`). Everything else 404s. Trailing slashes are normalized.
    if (!entryPaths.has(normalizePath(url.pathname))) {
      return withCors(Response.json({ error: 'Not Found', entryPaths: [...entryPaths] }, { status: 404 }), request);
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

    // A GET opens the server→client SSE stream; a POST may stream SSE when the
    // handler is configured for it AND the client accepts text/event-stream.
    // Otherwise the POST response is buffered JSON. `enableJsonResponse` only
    // governs POST; GET always streams.
    const accept = request.headers.get('accept') ?? '';
    const wantsStream =
      request.method === 'GET' || (sseEnabled && accept.includes('text/event-stream'));

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: !wantsStream,
    });

    await mcpServer.connect(transport);
    const response = await transport.handleRequest(request, {
      authInfo: options.authInfo as AuthInfo | undefined,
    });

    // If the response is an SSE stream, its body keeps producing AFTER this
    // function returns — tearing the server down now (the old `finally`) would
    // close the stream immediately. Keep the server alive until the transport
    // closes (client disconnects / stream ends), holding the isolate open via
    // `ctx.waitUntil`. Buffered-JSON responses are fully materialized, so we can
    // close right away.
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const closed = new Promise<void>((resolve) => {
        const prev = transport.onclose;
        transport.onclose = () => {
          prev?.();
          resolve();
        };
      });
      const teardown = closed.then(() => mcpServer.close().catch(() => undefined));
      if (ctx?.waitUntil) ctx.waitUntil(teardown);
      else void teardown;
    } else {
      void mcpServer.close().catch(() => undefined);
    }
    return withCors(response, request);
  };
}
