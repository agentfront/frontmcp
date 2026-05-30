// common/types/options/http/interfaces.ts
// Explicit TypeScript interfaces for HTTP configuration

import { type FrontMcpServer, type HttpMethod, type ServerRequestHandler } from '../../../interfaces';

/**
 * Framework-agnostic CORS configuration options.
 */
export interface CorsOptions {
  /**
   * Allowed origins. Can be:
   * - `true` to reflect the request origin (allows all origins with credentials)
   * - A string for a single origin
   * - An array of strings for multiple origins
   * - A function that dynamically determines if an origin is allowed
   */
  origin?:
    | boolean
    | string
    | string[]
    | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);

  /**
   * Whether to allow credentials (cookies, authorization headers).
   * @default false
   */
  credentials?: boolean;

  /**
   * How long preflight results can be cached (in seconds).
   */
  maxAge?: number;
}

/**
 * A single first-class custom HTTP route mounted alongside the MCP endpoint.
 *
 * Handlers run on the same Express app as the MCP JSON-RPC entry, so they share
 * the configured CORS policy, body limits, and security middleware. The handler
 * uses the framework-agnostic `(req, res, next)` signature; respond with
 * `res.status(...).send(...)` / `res.json(...)` or call `next()` to fall through.
 *
 * @see HttpOptionsInterface.routes
 */
export interface HttpRouteConfig {
  /** HTTP method to match (e.g. `'GET'`, `'POST'`). */
  method: HttpMethod;

  /**
   * Express-style path to mount the handler at (e.g. `'/download/:id'`).
   *
   * Paths that collide with FrontMCP's reserved surfaces — the resolved MCP
   * entry path (and its `/sse` + `/message` siblings), `/oauth/*`,
   * `/.well-known/*`, `/health`, and `/metrics` — are rejected at startup with
   * a fail-fast error.
   */
  path: string;

  /**
   * Route handler. `(req, res, next) => void | Promise<void>`.
   *
   * **Content-Type gotcha:** the built-in Express adapter defaults every
   * response to `application/json; charset=utf-8`. HTML, binary, or streaming
   * handlers MUST set their own content type via `res.type(...)` /
   * `res.setHeader('Content-Type', ...)` before sending the body.
   */
  handler: ServerRequestHandler;

  /**
   * When `true`, the request is run through the same `session:verify` flow the
   * MCP endpoint uses. Unauthorized/forbidden requests are short-circuited with
   * a `401`/`403` and a `WWW-Authenticate` header; on success the verified
   * authorization is attached to `req.authSession` before the handler runs.
   *
   * @default false (public)
   */
  auth?: boolean;
}

/**
 * HTTP server configuration options.
 */
export interface HttpOptionsInterface {
  /**
   * Port number to listen on.
   * @default 3001
   */
  port?: number;

  /**
   * MCP JSON-RPC entry path ('' or '/mcp').
   * MUST match PRM resourcePath returned in well-known.
   * @default ''
   */
  entryPath?: string;

  /**
   * Custom host factory to provide HTTP server implementation.
   * Can be a FrontMcpServer instance or a factory function.
   */
  hostFactory?: FrontMcpServer | ((config: HttpOptionsInterface) => FrontMcpServer);

  /**
   * Unix socket path for local-only server mode.
   * When set, the server listens on a Unix socket instead of a TCP port.
   * The entire HTTP feature set (streamable HTTP, SSE, elicitation, sessions)
   * works unchanged over Unix sockets.
   */
  socketPath?: string;

  /**
   * CORS configuration.
   * - `undefined` (default): permissive CORS enabled (all origins, no credentials)
   * - `false`: CORS disabled entirely
   * - `CorsOptions`: custom CORS configuration
   */
  cors?: CorsOptions | false;

  /**
   * Security configuration for transport hardening.
   * These options are opt-in — defaults remain backwards-compatible.
   * Set `strict: true` to enable all security features at once.
   */
  security?: SecurityOptions;

  /**
   * Maximum accepted body size for JSON-RPC POST requests parsed via
   * `express.json()`. Accepts the same shape as body-parser:
   *   - `number` of bytes (e.g. `1_048_576`)
   *   - human-readable string (e.g. `'4mb'`, `'500kb'`, `'2gb'`)
   *
   * When omitted, FrontMCP applies a default of `'4mb'`, lifting body-parser's
   * silent 100KB default that previously made base64-encoded blobs (PDFs,
   * DOCXes, large HTML pages) fail with HTTP 413 before reaching tool
   * handlers.
   *
   * Requests exceeding this limit receive a structured JSON-RPC 413 response:
   * `{ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload Too Large', data: { limit, length } } }`.
   *
   * **Security note.** This default trades the implicit 100KB DoS guard for a
   * better developer experience. Deployments exposed to untrusted networks
   * should set an explicit lower bound here (`'500kb'`, `'1mb'`, …) sized for
   * their actual payloads. Body-parser buffers the full body in memory before
   * parsing, so raising this value scales request memory linearly with
   * concurrency.
   *
   * @default '4mb'
   */
  bodyLimit?: number | string;

  /**
   * Maximum accepted body size for `application/x-www-form-urlencoded`
   * requests parsed via `express.urlencoded()`. Same value shape as
   * {@link bodyLimit}.
   *
   * When omitted, falls back to {@link bodyLimit}.
   */
  urlencodedLimit?: number | string;

  /**
   * First-class custom HTTP routes mounted on the same Express app as the MCP
   * endpoint. Each route shares the configured CORS, body limits, and security
   * middleware. Use these for out-of-band byte delivery (file/stream/binary
   * downloads), health probes beyond `/health`, webhooks, or any non-JSON-RPC
   * surface the MCP channel cannot serve.
   *
   * Routes are public by default; set `auth: true` to gate a route behind the
   * MCP `session:verify` flow. Paths that collide with reserved FrontMCP
   * surfaces are rejected at startup.
   *
   * @see HttpRouteConfig
   */
  routes?: HttpRouteConfig[];
}

/**
 * Security options for transport hardening.
 */
export interface SecurityOptions {
  /**
   * Enable strict security defaults.
   * When true: loopback binding (standalone), restrictive CORS, DNS rebinding protection.
   * @default false
   */
  strict?: boolean;

  /**
   * Network bind address override.
   * - `'loopback'`: bind to 127.0.0.1 (local access only)
   * - `'all'`: bind to 0.0.0.0 (all interfaces)
   * - string: specific IP address
   *
   * Default (no strict): '0.0.0.0' (backwards compatible)
   * Default (strict, standalone): '127.0.0.1'
   * Default (strict, distributed): '0.0.0.0'
   */
  bindAddress?: 'loopback' | 'all' | string;

  /**
   * DNS rebinding protection configuration.
   * When enabled, validates Host and Origin headers on incoming requests.
   */
  dnsRebindingProtection?: {
    /** Enable host/origin header validation. @default false */
    enabled?: boolean;
    /** Allowed Host header values (e.g., ['localhost:3001', 'api.example.com']) */
    allowedHosts?: string[];
    /** Allowed Origin header values (e.g., ['https://app.example.com']) */
    allowedOrigins?: string[];
  };
}
