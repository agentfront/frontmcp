/**
 * Web-standard `fetch` handler for FrontMCP — the V8-isolate adapter (Cloudflare
 * Workers, Deno Deploy, Bun) where Node `http` objects don't exist.
 *
 * It does NOT bypass the request pipeline: it translates the native Web
 * `Request` into the normalized `ServerRequest`, runs the SAME `http:request`
 * flow every other transport runs (auth, quota, router, audit, metrics + hooks),
 * and renders the flow's normalized `httpOutput` back to a Web `Response`. The
 * flow's web-mode MCP execute stage (`handleWebFetch`) produces the MCP response
 * via the SDK's `WebStandardStreamableHTTPServerTransport`. The adapter itself
 * only handles transport-level concerns — CORS, liveness probes, and entry-path
 * routing — which are not flow stages.
 */
import { FlowControl } from '../common';
import { type HttpMethod, type ServerRequest } from '../common/interfaces/server.interface';
import { type HttpOutput } from '../common/schemas/http-output.schema';
import { ServerRequestTokens } from '../common/tokens/server.tokens';
import { type CorsOptions } from '../common/types/options/http/interfaces';
import { normalizeEntryPrefix } from '../common/utils/path.utils';
import { PublicMcpError } from '../errors';
import { type Scope } from '../scope/scope.instance';
import { renderHttpOutputToWebResponse } from './web-response.renderer';
import { type WebStandardMcpPair } from './web-standard-mcp';

/**
 * The host execution context — its `waitUntil` keeps the worker alive past the
 * `fetch` return so a streaming (SSE) response body can finish. Optional: in
 * Node there's no isolate teardown, so it's only needed on V8 isolates.
 */
export interface FetchHandlerCtx {
  waitUntil?(promise: Promise<unknown>): void;
}

/** A Web-standard fetch handler: `(request, ctx?, env?) => Promise<Response>`. */
export type WebFetchHandler = (request: Request, ctx?: FetchHandlerCtx, env?: unknown) => Promise<Response>;

/**
 * Routes an MCP request to a stateful session host (a Cloudflare Durable Object)
 * instead of handling it statelessly. Receives the per-request `env` (for the DO
 * binding). Returns a `Response` when it routed the request, or `undefined` to
 * fall through to stateless handling (e.g. the binding isn't present).
 */
export type WebFetchSessionRouter = (
  request: Request,
  env: unknown,
  ctx?: FetchHandlerCtx,
) => Promise<Response | undefined>;

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
   * CORS for browser MCP clients (Inspector "Direct" mode, web apps). A
   * transport-adapter concern, not a flow stage. **Config-driven**: when
   * omitted, it mirrors the scope's `http.cors` (the same config the Express
   * host uses), so `@FrontMcp({ http: { cors } })` covers both. An explicit
   * value here overrides that.
   */
  cors?: WebFetchCorsOptions;
  /**
   * Optional stateful-session router (Cloudflare Durable Object host). When set,
   * MCP requests at the entry path are offered to it first; if it returns a
   * `Response` the request was routed to a session DO, otherwise handling falls
   * through to the stateless path. CORS / health / entry-path routing stay here
   * in the adapter regardless.
   */
  sessionRouter?: WebFetchSessionRouter;
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

  return async function handle(request: Request, ctx?: FetchHandlerCtx, env?: unknown): Promise<Response> {
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

    // MCP is served only at the configured entry path(s). Everything else 404s.
    // Trailing slashes are normalized.
    if (!entryPaths.has(normalizePath(url.pathname))) {
      return withCors(Response.json({ error: 'Not Found', entryPaths: [...entryPaths] }, { status: 404 }), request);
    }

    // Run the request through the REAL `http:request` flow (auth, quota, router,
    // audit, metrics + hooks) — the worker is just another adapter; the flow
    // decides. The flow's `handleWebFetch` execute stage produces the MCP
    // response via the WebStandard transport, carried back as a `web-response`
    // output. We render whatever normalized output the flow emits (a 401 from
    // the auth stage, the MCP response, etc.) to a Web `Response`.
    // Stateful sessions: offer the request to the Durable Object session router
    // first. If it routed (returned a Response), use it; otherwise fall through
    // to stateless handling.
    if (options.sessionRouter) {
      const routed = await options.sessionRouter(request, env, ctx);
      if (routed) return withCors(routed, request);
    }

    const rendered = await runHttpRequestFlowWeb(scope, request, { ctx });
    // `next`/`handled`/no-output means no MCP handler claimed the request.
    return withCors(rendered ?? Response.json({ error: 'Not Found' }, { status: 404 }), request);
  };
}

/**
 * Run a Web `Request` through the `http:request` flow and render its normalized
 * output to a Web `Response`. Shared by {@link createWebFetchHandler} (stateless)
 * and the Durable Object session host (which passes its `persistent` transport
 * so the GET notification stream + server push work). Returns `undefined` when
 * the flow produced no response (`next`/`handled`) — the caller decides the
 * fallback (typically 404).
 */
export async function runHttpRequestFlowWeb(
  scope: Scope,
  request: Request,
  opts: { ctx?: FetchHandlerCtx; persistent?: WebStandardMcpPair } = {},
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const serverRequest = await toServerRequest(request, url, opts.ctx, opts.persistent);
  let output: HttpOutput | undefined;
  try {
    output = (await scope.runFlow('http:request', {
      request: serverRequest,
      response: {},
    } as never)) as HttpOutput | undefined;
  } catch (error) {
    output = flowErrorToHttpOutput(error);
  }
  return output ? renderHttpOutputToWebResponse(output) : undefined;
}

/**
 * Build the normalized `ServerRequest` the flow consumes from a Web `Request`,
 * and carry the native Web `Request` (+ worker ctx) on it under the web tokens
 * so the flow's `handleWebFetch` stage can hand a fresh, unread request to the
 * WebStandard transport. The incoming body is read once (to populate
 * `request.body` for the router / intent decision) and re-attached to the fresh
 * request for the transport.
 */
async function toServerRequest(
  request: Request,
  url: URL,
  ctx?: FetchHandlerCtx,
  persistent?: WebStandardMcpPair,
): Promise<ServerRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((v, k) => {
    const existing = query[k];
    if (existing === undefined) query[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else query[k] = [existing, v];
  });

  const method = request.method.toUpperCase() as HttpMethod;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  let rawBody = '';
  if (hasBody) {
    try {
      rawBody = await request.text();
    } catch {
      rawBody = '';
    }
  }
  let body: unknown;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }

  // A fresh Web Request for the transport — the original body stream is consumed
  // above, and the WebStandard transport reads the body itself.
  const init: RequestInit = { method: request.method, headers: request.headers };
  if (rawBody) (init as RequestInit & { body: string }).body = rawBody;
  const webRequest = new Request(url.toString(), init);

  const serverRequest = {
    method,
    path: url.pathname,
    url: url.pathname + url.search,
    headers,
    query,
    body,
  } as unknown as ServerRequest;

  const tokenized = serverRequest as unknown as Record<PropertyKey, unknown>;
  tokenized[ServerRequestTokens.webRequest] = webRequest;
  tokenized[ServerRequestTokens.webCtx] = ctx;
  if (persistent) tokenized[ServerRequestTokens.webTransport] = persistent;
  return serverRequest;
}

/**
 * Map an error thrown out of `runFlow('http:request', …)` to a normalized
 * `HttpOutput`, mirroring the Express middleware's FlowControl handling. Returns
 * `undefined` for `next`/`handled` (no response → the caller 404s).
 */
function flowErrorToHttpOutput(error: unknown): HttpOutput | undefined {
  if (error instanceof FlowControl) {
    switch (error.type) {
      case 'respond':
        return error.output as HttpOutput;
      case 'next':
      case 'handled':
        return undefined;
      default: // 'abort' | 'fail'
        return { kind: 'text', status: 500, body: 'Internal Server Error', contentType: 'text/plain; charset=utf-8' };
    }
  }
  if (error instanceof PublicMcpError) {
    const challenge = error.wwwAuthenticate;
    return {
      kind: 'json',
      status: error.statusCode,
      contentType: 'application/json; charset=utf-8',
      body: { error: error.getPublicMessage() },
      ...(typeof challenge === 'string' && challenge.length > 0
        ? { headers: { 'WWW-Authenticate': challenge } }
        : {}),
    };
  }
  return { kind: 'text', status: 500, body: 'Internal Server Error', contentType: 'text/plain; charset=utf-8' };
}
