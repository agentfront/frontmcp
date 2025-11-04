// auth/path.utils.ts

import { ServerRequest } from '@frontmcp/sdk';

export function trimSlashes(s: string) {
  return (s ?? '').replace(/^\/+|\/+$/g, '');
}

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

/** Join URL path segments with a single slash and no trailing slash */
export function joinPath(...parts: string[]) {
  const cleaned = parts.map((p) => trimSlashes(p)).filter(Boolean);
  return cleaned.length ? `/${cleaned.join('/')}` : '';
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
