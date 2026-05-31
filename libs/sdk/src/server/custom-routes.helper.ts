// server/custom-routes.helper.ts
//
// First-class custom HTTP routes (issue #465).
//
// The low-level plumbing (`registerRoute`) already exists on the host adapter.
// This helper exposes the config-level `http.routes` surface: it validates each
// route path against FrontMCP's reserved surfaces (fail-fast on collisions),
// optionally wraps the handler in the MCP `session:verify` auth flow, and
// registers it on the active server.
//
// Registration happens from the scope (not the bare server instance) because:
//   1. `auth: true` runs `scope.runFlow('session:verify', ...)`, which only the
//      scope can dispatch.
//   2. The reserved-path guard needs the *resolved* MCP entry path, which the
//      scope computes from `entryPath` + `routeBase` (split-by-app aware).

import {
  FlowControl,
  httpRespond,
  normalizeEntryPrefix,
  normalizeScopeBase,
  ServerRequestTokens,
  type FrontMcpLogger,
  type FrontMcpServer,
  type HttpRouteConfig,
  type ServerRequest,
  type ServerRequestHandler,
  type ServerResponse,
} from '../common';
import { writeHttpResponse } from './server.validation';

/** Shape of the `session:verify` flow output we care about here. */
export type VerifyResult =
  | { kind: 'authorized'; authorization: unknown }
  | { kind: 'unauthorized'; prmMetadataHeader: string }
  | { kind: 'forbidden'; prmMetadataHeader: string };

/**
 * Dispatch the MCP `session:verify` flow for a request. The scope passes a thin
 * closure over its generic `runFlow` so this helper stays decoupled from the
 * scope's flow-name typing.
 */
export type VerifySessionFn = (request: ServerRequest) => Promise<VerifyResult | undefined>;

export interface RegisterCustomHttpRoutesArgs {
  /** Custom routes from `http.routes`. */
  routes: HttpRouteConfig[] | undefined;
  /** Active host server to register routes on. */
  server: FrontMcpServer;
  /** Runs `session:verify` for `auth: true` routes. */
  verifySession: VerifySessionFn;
  /** Resolved gateway entry path (e.g. `''` or `'/mcp'`). */
  entryPath: string;
  /** Per-app / per-scope route base (e.g. `''` or `'/billing'`). */
  routeBase: string;
  logger: FrontMcpLogger;
}

/**
 * Error thrown when a custom `http.routes` path collides with a FrontMCP
 * reserved surface. Fail-fast at startup rather than silently shadowing (or
 * being shadowed by) the MCP endpoint / discovery / health surfaces.
 */
export class ReservedRouteCollisionError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly reserved: string,
  ) {
    super(
      `Custom http.route "${method} ${path}" collides with the reserved FrontMCP path "${reserved}". ` +
        `Reserved prefixes are the MCP entry path (and its /sse + /message siblings), ` +
        `/oauth/*, /.well-known/*, /health, and /metrics. Choose a different path.`,
    );
    this.name = 'ReservedRouteCollisionError';
  }
}

/**
 * Build the exact-match + prefix reserved-path set for the resolved MCP base.
 *
 * - Exact matches: the MCP base itself, `<base>/sse`, `<base>/message`,
 *   `/health`, `/metrics`.
 * - Prefix matches: `/oauth`, `/.well-known` (any sub-path is reserved).
 */
export function computeReservedPaths(entryPath: string, routeBase: string): { exact: Set<string>; prefixes: string[] } {
  const prefix = normalizeEntryPrefix(entryPath);
  const base = normalizeScopeBase(routeBase);
  const mcpBase = `${prefix}${base}`; // '' | '/mcp' | '/mcp/billing'

  const exact = new Set<string>([
    mcpBase === '' ? '/' : mcpBase,
    `${mcpBase}/sse`,
    `${mcpBase}/message`,
    '/health',
    '/metrics',
  ]);

  return { exact, prefixes: ['/oauth', '/.well-known'] };
}

/** Normalize a path for collision comparison: strip trailing slash (except root), lowercase nothing (paths are case-sensitive). */
function normalizeForCompare(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/**
 * Throw {@link ReservedRouteCollisionError} when `path` collides with a
 * reserved FrontMCP surface. Express path params (`:id`) and wildcards in the
 * *custom* path are compared literally — only the static prefix matters for the
 * reserved-surface check, so a route like `/files/:id` never collides unless it
 * is literally under `/oauth`, `/.well-known`, etc.
 */
export function assertNotReserved(
  method: string,
  path: string,
  reserved: { exact: Set<string>; prefixes: string[] },
): void {
  const normalized = normalizeForCompare(path);

  if (reserved.exact.has(normalized)) {
    throw new ReservedRouteCollisionError(method, path, normalized);
  }

  for (const prefix of reserved.prefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      throw new ReservedRouteCollisionError(method, path, prefix);
    }
  }
}

/**
 * Wrap a user route handler in the MCP `session:verify` auth flow. On
 * unauthorized/forbidden the request is short-circuited with a 401/403 carrying
 * the `WWW-Authenticate` header (mirroring `http.request.flow.ts`); on success
 * the verified authorization is attached to `req.authSession` (and the internal
 * auth token) before the user handler runs.
 */
export function wrapWithAuth(
  handler: ServerRequestHandler,
  verifySession: VerifySessionFn,
  logger: FrontMcpLogger,
): ServerRequestHandler {
  return async (req: ServerRequest, res: ServerResponse, next) => {
    let result: VerifyResult | undefined;
    try {
      result = await verifySession(req);
    } catch (error) {
      // `session:verify` resolves its outcome as a return value, but guard for
      // the FlowControl('respond') envelope in case it ever escapes.
      if (error instanceof FlowControl && error.type === 'respond') {
        result = error.output as VerifyResult;
      } else {
        throw error;
      }
    }

    if (!result || result.kind === 'unauthorized') {
      logger.verbose('custom-route auth: unauthorized');
      return writeHttpResponse(
        res,
        httpRespond.unauthorized({
          headers: result?.kind === 'unauthorized' ? { 'WWW-Authenticate': result.prmMetadataHeader } : undefined,
        }),
      );
    }

    if (result.kind === 'forbidden') {
      logger.verbose('custom-route auth: forbidden (insufficient scope)');
      return writeHttpResponse(
        res,
        httpRespond.forbidden({
          headers: { 'WWW-Authenticate': result.prmMetadataHeader },
        }),
      );
    }

    // Authorized — attach auth to the request for the user handler.
    req.authSession = result.authorization as ServerRequest['authSession'];
    req[ServerRequestTokens.auth] = result.authorization as never;
    return handler(req, res, next);
  };
}

/**
 * Register all configured custom HTTP routes on the active server.
 *
 * No-op when `routes` is empty/undefined. Throws {@link ReservedRouteCollisionError}
 * (fail-fast) on the first path that collides with a reserved surface — so a
 * misconfiguration aborts boot instead of silently mis-mounting.
 */
export function registerCustomHttpRoutes(args: RegisterCustomHttpRoutesArgs): void {
  const { routes, server, verifySession, entryPath, routeBase, logger } = args;
  if (!routes || routes.length === 0) return;

  const reserved = computeReservedPaths(entryPath, routeBase);

  for (const route of routes) {
    assertNotReserved(route.method, route.path, reserved);

    const handler = route.auth === true ? wrapWithAuth(route.handler, verifySession, logger) : route.handler;
    server.registerRoute(route.method, route.path, handler);
    logger.info(`Registered custom http route: ${route.method} ${route.path}${route.auth ? ' (auth)' : ''}`);
  }
}
