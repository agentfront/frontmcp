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
 * routing, Host validation — which are not flow stages, and it supplies the
 * platform's peer address, which the flows' `checkIpFilter` stage decides on.
 */
import { runRequestExclusive } from '@frontmcp/utils';

import { FlowControl } from '../common';
import { type HttpMethod, type ServerRequest } from '../common/interfaces/server.interface';
import { type HttpOutput } from '../common/schemas/http-output.schema';
import { ServerRequestTokens } from '../common/tokens/server.tokens';
import { type CorsOptions } from '../common/types/options/http/interfaces';
import { normalizeEntryPrefix, resolveEntryPath } from '../common/utils/path.utils';
import { PayloadTooLargeError, PublicMcpError } from '../errors';
import { findMisconfiguration, misconfigurationBody } from '../errors/misconfiguration';
import { isReadyzEnabled } from '../health/health.routes';
import { type Scope } from '../scope/scope.instance';
import { resolveSecurityHeaders } from '../server/middleware/csp.middleware';
import { compileHostValidation, validateHostHeaders } from '../server/security/host-validation';
import { renderHttpOutputToWebResponse } from './web-response.renderer';
import { type WebStandardMcpPair } from './web-standard-mcp';

/**
 * The host execution context — its `waitUntil` keeps the worker alive past the
 * `fetch` return so a streaming (SSE) response body can finish. Optional: in
 * Node there's no isolate teardown, so it's only needed on V8 isolates.
 * Deno's `info` and Bun's `server` arrive here too, carrying the client address.
 */
export interface FetchHandlerCtx {
  waitUntil?(promise: Promise<unknown>): void;
  /** Deno `ServeHandlerInfo.remoteAddr`. */
  remoteAddr?: { hostname?: string };
  /** Bun `Server.requestIP`. */
  requestIP?(request: Request): { address?: string } | null;
}

const CLOUDFLARE_WORKERS_USER_AGENT = 'Cloudflare-Workers';

function isCloudflareWorkersRuntime(request: Request): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent === CLOUDFLARE_WORKERS_USER_AGENT) return true;
  const cloudflareProperties = (request as Request & { cf?: unknown }).cf;
  return typeof cloudflareProperties === 'object' && cloudflareProperties !== null;
}

/** The platform's peer address, the web-fetch analog of `req.socket.remoteAddress` (GHSA-p3qf-fcwm-35x4). */
function resolvePeerAddress(request: Request, ctx: FetchHandlerCtx | undefined): string | undefined {
  if (typeof ctx?.requestIP === 'function') return ctx.requestIP(request)?.address;
  if (typeof ctx?.remoteAddr?.hostname === 'string') return ctx.remoteAddr.hostname;
  // Cloudflare's edge overwrites this header on every request into a Worker; elsewhere a caller wrote it.
  if (isCloudflareWorkersRuntime(request)) return request.headers.get('cf-connecting-ip') ?? undefined;
  return undefined;
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
  const healthConfig = scope.metadata.health ?? {};
  // `health.enabled: false` turns the probes off entirely; an explicit
  // `options.healthPaths` keeps the legacy static-`ok` behaviour for those paths.
  const healthEnabled = healthConfig.enabled !== false;
  const healthzPath = healthConfig.healthzPath ?? '/healthz';
  const readyzPath = healthConfig.readyzPath ?? '/readyz';
  const readyzEnabled = isReadyzEnabled(healthConfig);
  const bodyLimit = parseByteLimit(httpConfig?.bodyLimit);
  const securityHeaders = resolveSecurityHeaders(httpConfig?.securityHeaders);
  // Normalize a path: ensure a leading slash, drop a trailing slash (keeping
  // root as `/`). So `/mcp`, `/mcp/`, and a configured `mcp` all compare equal.
  const normalizePath = (p: string): string => {
    const withSlash = p.startsWith('/') ? p : `/${p}`;
    // Linear trailing-slash trim. Avoids the polynomial-backtracking `/\/+$/`
    // regex on an attacker-controlled path (CodeQL js/polynomial-redos): a path
    // of many '/' would make that regex O(n²). Keeps root as `/`.
    let end = withSlash.length;
    while (end > 1 && withSlash.charCodeAt(end - 1) === 47 /* '/' */) end--;
    return withSlash.slice(0, end);
  };
  // The single MCP endpoint path, driven by config: explicit option → scope's
  // `http.entryPath` (the Express gateway prefix) → worker root `/`. The worker
  // serves exactly where it's configured (not a guessed `/` + `/mcp` set); an
  // explicit array still opts into a multi-path allow-list.
  const rawEntry = options.entryPath ?? (normalizeEntryPrefix(resolveEntryPath(httpConfig?.entryPath)) || '/');
  const entryPaths = new Set((Array.isArray(rawEntry) ? rawEntry : [rawEntry]).map(normalizePath));
  // CORS: explicit option wins, else mirror the scope's `http.cors`.
  const cors = options.cors ?? mapHttpCors(httpConfig?.cors, scope);
  const corsEnabled = cors?.origin !== undefined && cors.origin !== false;

  // Host / Origin validation (GHSA-mc9g-v2cp-vfff) — the same rules the Express
  // host applies, from the same module, so the two adapters cannot diverge.
  //
  // A worker is always reached under a hostname this process cannot enumerate,
  // so there is no safe derived default here: validation runs only when the
  // operator configured `allowedHosts` / `allowedOrigins`. That is the same
  // outcome the Express host reaches for a routable bind.
  const rebinding = httpConfig?.security?.dnsRebindingProtection;
  const hostValidation =
    rebinding?.enabled === false || (!rebinding?.allowedHosts?.length && !rebinding?.allowedOrigins?.length)
      ? undefined
      : compileHostValidation({
          allowedHosts: rebinding.allowedHosts,
          allowedOrigins: rebinding.allowedOrigins,
        });

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

  /** Merge the resolved security headers into a response without overriding ones the flow already set. */
  const withSecurityHeaders = (response: Response): Response => {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(securityHeaders)) if (!headers.has(k)) headers.set(k, v);
    headers.delete('x-powered-by');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  const handleRequest = async (request: Request, ctx?: FetchHandlerCtx, env?: unknown): Promise<Response> => {
    const url = new URL(request.url);

    // Host validation runs FIRST, before CORS preflight, health probes and any
    // routing — a request naming a host this server does not answer to is not
    // answered at all.
    if (hostValidation) {
      const rejection = validateHostHeaders(
        {
          host: request.headers.get('host') ?? url.host,
          forwardedHost: request.headers.get('x-forwarded-host') ?? undefined,
          origin: request.headers.get('origin') ?? undefined,
        },
        hostValidation,
      );
      if (rejection) {
        return Response.json({ error: rejection.error, message: rejection.message }, { status: rejection.status });
      }
    }

    // Body size limit (`http.bodyLimit`) — enforced before routing, like the
    // Express body parsers, so an oversized body is never buffered.
    const limited = await enforceBodyLimit(request, bodyLimit);
    if (limited instanceof Response) return withCors(limited, request);
    request = limited;

    // CORS preflight — answer OPTIONS directly (transport-adapter concern).
    if (corsEnabled && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeadersFor(request) });
    }

    // Liveness/readiness — cheap, no MCP server spin-up.
    if (options.healthPaths ? options.healthPaths.includes(url.pathname) : healthEnabled) {
      const isReadyz = !options.healthPaths && url.pathname === readyzPath && readyzEnabled;
      const isHealthz = options.healthPaths
        ? url.pathname !== '/readyz'
        : url.pathname === healthzPath || url.pathname === '/health';
      if (isReadyz && scope.healthService) {
        const readiness = await scope.healthService.getReadyz();
        return withCors(
          Response.json(
            { ...readiness, transport: 'web-fetch' },
            { status: readiness.status === 'ready' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
          ),
          request,
        );
      }
      if (isHealthz || isReadyz || options.healthPaths) {
        return withCors(
          Response.json(
            { status: 'ok', server: scope.metadata.info, transport: 'web-fetch' },
            { headers: { 'Cache-Control': 'no-store' } },
          ),
          request,
        );
      }
    }

    // MCP is served only at the configured entry path(s). Everything else is
    // NOT auto-404'd: auth / well-known / OAuth endpoints (PRM + AS metadata,
    // /oauth/authorize|token|register|callback, JWKS, /userinfo) are real flows
    // that self-select by path/canActivate. The Express host mounts them as
    // middleware; the Worker has no middleware server, so we dispatch the
    // matching flow here through the SAME flow pipeline (hookable) instead of
    // hand-rolling discovery. Trailing slashes are normalized.
    if (!entryPaths.has(normalizePath(url.pathname))) {
      const authResponse = await runMatchingHttpFlowWeb(scope, request, { ctx, env });
      if (authResponse) return withCors(authResponse, request);
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

    const rendered = await runHttpRequestFlowWeb(scope, request, { ctx, env });
    // `next`/`handled`/no-output means no MCP handler claimed the request.
    return withCors(rendered ?? Response.json({ error: 'Not Found' }, { status: 404 }), request);
  };

  return async function handle(request: Request, ctx?: FetchHandlerCtx, env?: unknown): Promise<Response> {
    return withSecurityHeaders(await handleRequest(request, ctx, env));
  };
}

const DEFAULT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const BYTE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

/** Parse `http.bodyLimit` (`'4mb'`, `'512kb'`, or a byte count) the way `bytes`/body-parser does. */
function parseByteLimit(limit: number | string | undefined): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) return limit;
  if (typeof limit === 'string') {
    const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(limit.trim());
    if (match) return Math.floor(Number(match[1]) * BYTE_UNITS[(match[2] ?? 'b').toLowerCase()]);
  }
  return DEFAULT_BODY_LIMIT_BYTES;
}

function payloadTooLarge(limit: number, length?: number): Response {
  const error = new PayloadTooLargeError(limit, length);
  return Response.json({ jsonrpc: '2.0', error: error.toJsonRpcError(), id: null }, { status: 413 });
}

/**
 * Enforce `http.bodyLimit` on a Web `Request`. A declared `content-length` over
 * the limit is refused without reading anything; a body with no declared length
 * is read through a byte counter and refused as soon as it crosses the limit.
 * Returns the request to continue with (re-buffered when it had to be read), or
 * a 413 `Response`.
 */
async function enforceBodyLimit(request: Request, limit: number): Promise<Request | Response> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !request.body) return request;

  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) return payloadTooLarge(limit, length);
    return request;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return payloadTooLarge(limit, total);
    }
    chunks.push(value);
  }
  const buffered = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffered.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, { method: request.method, headers: request.headers, body: buffered });
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
  opts: { ctx?: FetchHandlerCtx; env?: unknown; persistent?: WebStandardMcpPair } = {},
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const serverRequest = await toServerRequest(request, url, opts.ctx, opts.persistent, opts.env);
  let output: HttpOutput | undefined;
  try {
    // One request at a time in a browser build without AsyncContext (a no-op on Node and Workers).
    output = (await runRequestExclusive(() =>
      scope.runFlow('http:request', {
        request: serverRequest,
        response: {},
      } as never),
    )) as HttpOutput | undefined;
  } catch (error) {
    output = flowErrorToHttpOutput(error);
  }
  return output ? renderHttpOutputToWebResponse(output) : undefined;
}

/**
 * Dispatch a non-entry-path request through the FrontMCP flow that claims it
 * (auth / well-known / oauth flows match by `middleware.path` + `canActivate`).
 * Mirrors the Express host's route dispatch for runtimes with no middleware
 * server (Cloudflare Worker / web-fetch). Returns the rendered Web `Response`,
 * or `undefined` when no flow matches (caller 404s).
 *
 * Carries the worker `ctx` and `env` for the same reason `http:request` does:
 * an auth or OAuth flow on a Worker reaches its bindings only through
 * `ServerRequestTokens.webEnv`, and dropping them here would leave exactly the
 * flows that need a KV-backed store without one.
 */
export async function runMatchingHttpFlowWeb(
  scope: Scope,
  request: Request,
  opts: { ctx?: FetchHandlerCtx; env?: unknown } = {},
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const serverRequest = await toServerRequest(request, url, opts.ctx, undefined, opts.env);
  const flowName = await scope.findHttpFlowName(serverRequest);
  if (!flowName) return undefined;
  let output: HttpOutput | undefined;
  try {
    output = (await runRequestExclusive(() =>
      scope.runFlow(flowName, {
        request: serverRequest,
        response: {},
      } as never),
    )) as HttpOutput | undefined;
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
  env?: unknown,
): Promise<ServerRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  // A Web `Request` carries its address in its URL; runtimes don't always add a
  // `Host` header (and `new Request(url)` never does). The resource URL, the
  // issuer and the same-origin checks read `Host` and the scheme, so take both
  // from the URL rather than build them from nothing (`http://undefined`). The
  // URL is the runtime's own address for the request, so it also wins over a
  // `Host` header that disagrees with it: a header an intermediary or a caller
  // set must not choose the issuer, the token audience or the discovery URLs.
  // Behind a proxy that rewrites the URL, pin FRONTMCP_PUBLIC_URL (or trust the
  // proxy's X-Forwarded-Host with FRONTMCP_TRUST_PROXY).
  headers['host'] = url.host;

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
    // The scheme the client used, as Express reports it (`req.protocol`).
    protocol: url.protocol.slice(0, -1),
    path: url.pathname,
    url: url.pathname + url.search,
    headers,
    query,
    body,
    socket: { remoteAddress: resolvePeerAddress(request, ctx) },
  } as unknown as ServerRequest;

  const tokenized = serverRequest as unknown as Record<PropertyKey, unknown>;
  tokenized[ServerRequestTokens.webRequest] = webRequest;
  tokenized[ServerRequestTokens.webCtx] = ctx;
  tokenized[ServerRequestTokens.webEnv] = env;
  if (persistent) tokenized[ServerRequestTokens.webTransport] = persistent;
  return serverRequest;
}

/**
 * Render a recognized configuration fault as a Web `Response`, or `undefined`
 * when the error is not one.
 *
 * Exported because a missing secret can surface on two different paths: from
 * inside the `http:request` flow (a `SessionSecretRequiredError` thrown during
 * `session:verify`) or out of the lazy scope build that `createFetchHandler`
 * memoizes, which happens BEFORE any flow exists (a `JwtSecretRequiredError`
 * thrown while the auth instance is constructed). Both must answer the same
 * structured body, so both go through here.
 */
export function misconfigurationResponse(error: unknown): Response | undefined {
  const misconfiguration = findMisconfiguration(error);
  if (!misconfiguration) return undefined;
  return Response.json(misconfigurationBody(misconfiguration), { status: 500 });
}

/** The first retry of a failed deferred server build waits this long; each failure doubles it. */
const STARTUP_RETRY_MIN_MS = 1_000;
/** Longest wait between two attempts of a failed deferred server build. */
const STARTUP_RETRY_MAX_MS = 60_000;

/**
 * A server built on its first request (an edge isolate, a Durable Object), shared by every request
 * that arrives while it builds.
 *
 * A failed build is not retried by every request: the failure is kept, and requests are refused
 * with it, until a retry delay has passed (1 s after the first failure, doubling up to 60 s). The
 * first request after that tries again. A successful build is kept for the isolate's lifetime.
 */
export interface DeferredServerBuild<T, A = void> {
  /**
   * The built server. Starts a build when none has succeeded and none is due to wait; otherwise
   * joins the build in flight, or rejects with the last failure while its retry delay lasts.
   */
  get(arg: A): Promise<T>;
  /** Seconds until a refused request may try again (at least 1), or 0 when nothing has failed. */
  retryAfterSeconds(): number;
}

/**
 * Create a {@link DeferredServerBuild}. `onFailure` sees each failed attempt once (to log its cause),
 * not each request refused with it. `arg` is what the request that starts a build passes to it (a
 * Worker's `env`, say).
 */
export function createDeferredServerBuild<T, A = void>(
  build: (arg: A) => Promise<T>,
  options: { onFailure?: (error: unknown) => void; now?: () => number } = {},
): DeferredServerBuild<T, A> {
  const now = options.now ?? Date.now;
  let built: { value: T } | undefined;
  let inFlight: Promise<T> | undefined;
  let failure: { error: unknown; retryAt: number; count: number } | undefined;

  return {
    get(arg: A): Promise<T> {
      if (built) return Promise.resolve(built.value);
      if (inFlight) return inFlight;
      if (failure && now() < failure.retryAt) return Promise.reject(failure.error);
      const failures = failure?.count ?? 0;
      inFlight = build(arg).then(
        (value) => {
          built = { value };
          failure = undefined;
          inFlight = undefined;
          return value;
        },
        (error: unknown) => {
          const delay = Math.min(STARTUP_RETRY_MAX_MS, STARTUP_RETRY_MIN_MS * 2 ** failures);
          failure = { error, retryAt: now() + delay, count: failures + 1 };
          inFlight = undefined;
          options.onFailure?.(error);
          throw error;
        },
      );
      return inFlight;
    },
    retryAfterSeconds(): number {
      if (!failure) return 0;
      return Math.max(1, Math.ceil((failure.retryAt - now()) / 1000));
    },
  };
}

/**
 * The answer to a request a server that could not be built refuses: a recognized configuration
 * fault as `500 server_misconfigured` (see {@link misconfigurationResponse}), anything else (a
 * remote that refused the connection, a package that failed to load) as `503 server_unavailable`
 * with `Retry-After`. Neither echoes the error, whose cause only the server log shows.
 */
export function startupFailureResponse(error: unknown, retryAfterSeconds = 1): Response {
  const misconfigured = misconfigurationResponse(error);
  if (misconfigured) return misconfigured;
  return Response.json(
    {
      error: 'server_unavailable',
      code: 'SERVER_START_FAILED',
      message:
        'The server failed to start, so it refuses requests. Its log has the cause; a request after the ' +
        'Retry-After delay tries to start it again.',
    },
    { status: 503, headers: { 'Retry-After': String(Math.max(1, retryAfterSeconds)) } },
  );
}

/**
 * Map an error thrown out of `runFlow('http:request', …)` to a normalized
 * `HttpOutput`, mirroring the Express middleware's FlowControl handling. Returns
 * `undefined` for `next`/`handled` (no response → the caller 404s).
 */
function flowErrorToHttpOutput(error: unknown): HttpOutput | undefined {
  // #546 — a deployment that is merely missing a secret used to answer a bare
  // `Internal Server Error`, so the only way to learn the cause was to tail the
  // live worker. Report the configuration fault instead.
  const misconfiguration = findMisconfiguration(error);
  if (misconfiguration) {
    return {
      kind: 'json',
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: misconfigurationBody(misconfiguration),
    };
  }

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
      ...(typeof challenge === 'string' && challenge.length > 0 ? { headers: { 'WWW-Authenticate': challenge } } : {}),
    };
  }
  return { kind: 'text', status: 500, body: 'Internal Server Error', contentType: 'text/plain; charset=utf-8' };
}
