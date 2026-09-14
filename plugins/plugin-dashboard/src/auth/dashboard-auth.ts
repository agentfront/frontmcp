import { sha256, timingSafeEqual } from '@frontmcp/utils';

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
function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length === 0 || expected.length === 0) return false;
  return timingSafeEqual(sha256(presented), sha256(expected));
}

/**
 * Create the dashboard's HTTP auth check.
 *
 * Returns `undefined` when authentication is not enabled, so the caller can skip
 * the check entirely rather than branch on a permissive validator.
 *
 * A token may be presented as `Authorization: Bearer <token>` (preferred — a URL
 * token lands in access logs, `Referer` headers and browser history) or as
 * `?token=<token>`, which is what the documented dashboard link uses.
 */
export function createDashboardAuthValidator(
  auth: DashboardAuth | undefined,
): ((req: DashboardAuthRequest) => DashboardAuthResult) | undefined {
  if (!auth?.enabled) return undefined;

  // `dashboardAuthSchema` refuses `enabled: true` without a token, so reaching
  // here without one would be a bug rather than a configuration mistake. Fail
  // closed regardless: serving the dashboard is the wrong way to handle it.
  const expected = auth.token;

  return (req) => {
    if (!expected) {
      return { authorized: false, status: 401, message: 'Dashboard authentication is misconfigured' };
    }

    const header = readHeader(req.headers, 'authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (bearer && tokenMatches(bearer, expected)) return AUTHORIZED;

    const queryToken = readQuery(req.query, 'token');
    if (queryToken && tokenMatches(queryToken, expected)) return AUTHORIZED;

    return { authorized: false, status: 401, message: 'Unauthorized' };
  };
}
