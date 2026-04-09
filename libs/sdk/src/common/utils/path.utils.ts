// auth/path.utils.ts

import { joinPath, trimSlashes } from '@frontmcp/utils';

import type { ServerRequest } from '../interfaces';

// Re-export for backwards compatibility
export { trimSlashes, joinPath } from '@frontmcp/utils';

/** Normalize entryPath (gateway prefix) to "" or "/mcp" */
export function normalizeEntryPrefix(entryPath?: string): string {
  const t = trimSlashes(entryPath ?? '');
  return t ? `/${t}` : '';
}

/** Normalize a scope base (per-app or per-auth) to "" or "/app1" */
export function normalizeScopeBase(scopeBase?: string): string {
  const t = trimSlashes(scopeBase ?? '');
  return t ? `/${t}` : '';
}

export function getRequestBaseUrl(req: ServerRequest, entryPath?: string) {
  const proto = (req.headers['x-forwarded-proto'] as string) || (req as any).protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers['host'];
  return `${proto}://${host}${entryPath ?? ''}`;
}

export function computeIssuer(req: ServerRequest, entryPath: string, scopeBase: string) {
  const entryPrefix = normalizeEntryPrefix(entryPath);
  const scope = normalizeScopeBase(scopeBase);
  return `${getRequestBaseUrl(req)}${entryPrefix}${scope}`;
}

export function computeResource(req: ServerRequest, entryPath: string, scopeBase: string) {
  const entryPrefix = normalizeEntryPrefix(entryPath);
  const scope = normalizeScopeBase(scopeBase);
  return `${getRequestBaseUrl(req)}${entryPrefix}${scope}`;
}

/**
 * Normalize a resource URI for comparison (RFC 8707).
 * Handles: trailing slash, default ports (443/80), case, path dots, fragments, query strings.
 */
export function normalizeResourceUri(uri: string): string {
  try {
    const url = new URL(uri);
    // Lowercase scheme and host (URL constructor does this automatically)
    let normalized = `${url.protocol}//${url.hostname}`;
    // Include port only if non-standard for the scheme
    const isDefaultPort =
      (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
    if (url.port && !isDefaultPort) {
      normalized += `:${url.port}`;
    }
    // Normalize path: resolve dots (URL constructor does this), remove trailing slash (unless root)
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    normalized += path;
    // Strip query and fragment
    return normalized;
  } catch {
    return uri; // Return as-is if not a valid URL
  }
}

/**
 * Compare two resource URIs after normalization (RFC 8707).
 */
export function resourceUriMatches(provided: string, canonical: string): boolean {
  return normalizeResourceUri(provided) === normalizeResourceUri(canonical);
}

/** Derive a safe provider id from a URL when no id is provided. */
export function urlToSafeId(url: string): string {
  const u = new URL(url);
  const raw = (u.host + (u.pathname && u.pathname !== '/' ? u.pathname : '')).replace(/\/+$/, '');
  return trimSlashes(raw).replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Build all path variants for a given well-known name:
 * - reversed under root: /.well-known/<name><entryPrefix><scopeBase>
 * - in prefix root: <entryPrefix>/.well-known/<name><scopeBase>
 * - in prefix + scope: <entryPrefix><scopeBase>/.well-known/<name>
 */
export function makeWellKnownPaths(name: string, entryPrefix: string, scopeBase = '') {
  const prefix = normalizeEntryPrefix(entryPrefix);
  const scope = normalizeScopeBase(scopeBase);
  const reversed = joinPath('.well-known', name) + `${prefix}${scope}`; // /.well-known/name + /mcp/app1
  const inPrefixRoot = `${prefix}${joinPath('.well-known', name)}${scope}`; // /mcp/.well-known/name + /app1
  const inPrefixScope = `${prefix}${scope}${joinPath('.well-known', name)}`; // /mcp/app1/.well-known/name
  return new Set([reversed, inPrefixRoot, inPrefixScope]);
}
