import { base64urlEncode, hmacSha256, sha256, timingSafeEqual } from '@frontmcp/utils';

import type { DashboardAuth } from '../dashboard.types';

/**
 * Token check for the dashboard's HTTP surface (GHSA-rgxj-434m-vxh3).
 *
 * `auth.token` was documented and schema-validated but never read, so a
 * dashboard an operator believed was protected served its page — and, through
 * its MCP scope, the whole server's inventory — to anyone.
 *
 * Shaped after `SkillHttpAuthValidator` in the SDK, which is the in-repo pattern
 * for gating an HTTP surface on a shared secret.
 */
export interface DashboardAuthRequest {
  headers?: Record<string, string | string[] | undefined> | undefined;
  query?: Record<string, string | string[] | undefined> | undefined;
}

/**
 * Header an MCP client sends the dashboard token in. `Authorization` belongs to the
 * server's own authentication, so on an authenticated server the dashboard token needs
 * a channel of its own.
 */
export const DASHBOARD_TOKEN_HEADER = 'x-frontmcp-dashboard-token';

/**
 * Cookie the dashboard page gets once its token was checked, so the page's own MCP
 * client (an `EventSource`, which cannot send headers) reaches the MCP endpoint without
 * putting the token in a URL.
 */
export const DASHBOARD_SESSION_COOKIE = 'frontmcp_dashboard';

/**
 * Which part of the dashboard a request is for.
 *
 * - `page`: the HTML page. Accepts `Authorization: Bearer`, `?token=` (the documented
 *   link) and the session cookie.
 * - `mcp`: the dashboard's MCP endpoint. Accepts `Authorization: Bearer`, the
 *   `x-frontmcp-dashboard-token` header and the session cookie, but not `?token=`: a URL
 *   token lands in access logs, `Referer` headers and browser history.
 */
export type DashboardAuthSurface = 'page' | 'mcp';

export interface DashboardAuthResult {
  authorized: boolean;
  status?: 401;
  message?: string;
}

const AUTHORIZED = { authorized: true } as const;

/** Read a header case-insensitively, taking the first value of a repeated one. */
function readHeader(headers: DashboardAuthRequest['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function readQuery(query: DashboardAuthRequest['query'], name: string): string | undefined {
  const value = query?.[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Constant-time token comparison.
 *
 * Both sides are hashed to fixed-length digests first, so neither the comparison
 * time nor `timingSafeEqual`'s equal-length requirement leaks the token length.
 * This is the same idiom the DCR client registry uses for client secrets.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(sha256(presented), sha256(expected));
}

const encoder = new TextEncoder();

/**
 * The session cookie's value: an HMAC of a fixed label keyed by the token, so the cookie
 * never holds the token itself and cannot be computed without it.
 */
export function deriveDashboardCookieValue(token: string): string {
  return base64urlEncode(hmacSha256(encoder.encode(token), encoder.encode('frontmcp-dashboard-session:v1')));
}

/** Read one cookie from a `Cookie` header. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header.
 *
 * RFC 7235 makes the scheme name case-insensitive and allows more than one
 * space before the token, so matching the literal `'Bearer '` rejects headers
 * that are perfectly valid. Only the scheme is normalized; the token bytes are
 * compared as sent (a `token68` cannot contain whitespace, so trimming it is
 * safe).
 */
function readBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const separator = header.indexOf(' ');
  if (separator === -1) return undefined;
  if (header.slice(0, separator).toLowerCase() !== 'bearer') return undefined;
  const token = header.slice(separator + 1).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Create the dashboard's HTTP auth check for one surface (see {@link DashboardAuthSurface}).
 *
 * Returns `undefined` when authentication is not enabled, so the caller can skip
 * the check entirely rather than branch on a permissive validator.
 *
 * `Authorization: Bearer <token>` is accepted on both surfaces; the page also takes
 * `?token=<token>` (the documented link), the MCP endpoint also takes
 * `x-frontmcp-dashboard-token`, and both take the cookie the page sets.
 */
export function createDashboardAuthValidator(
  auth: DashboardAuth | undefined,
  surface: DashboardAuthSurface = 'page',
): ((req: DashboardAuthRequest) => DashboardAuthResult) | undefined {
  if (!auth?.enabled) return undefined;

  // `dashboardAuthSchema` refuses `enabled: true` without a token, so reaching
  // here without one would be a bug rather than a configuration mistake. Fail
  // closed regardless: serving the dashboard is the wrong way to handle it.
  const expected = auth.token;
  const expectedCookie = expected ? deriveDashboardCookieValue(expected) : undefined;

  return (req) => {
    if (!expected || !expectedCookie) {
      return { authorized: false, status: 401, message: 'Dashboard authentication is misconfigured' };
    }

    const bearer = readBearerToken(readHeader(req.headers, 'authorization'));
    if (bearer && tokenMatches(bearer, expected)) return AUTHORIZED;

    if (surface === 'mcp') {
      const headerToken = readHeader(req.headers, DASHBOARD_TOKEN_HEADER);
      if (headerToken && tokenMatches(headerToken, expected)) return AUTHORIZED;
    } else {
      const queryToken = readQuery(req.query, 'token');
      if (queryToken && tokenMatches(queryToken, expected)) return AUTHORIZED;
    }

    const cookie = readCookie(readHeader(req.headers, 'cookie'), DASHBOARD_SESSION_COOKIE);
    if (cookie && tokenMatches(cookie, expectedCookie)) return AUTHORIZED;

    return { authorized: false, status: 401, message: 'Unauthorized' };
  };
}
