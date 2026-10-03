/**
 * Load-balancer affinity headers for distributed deployments.
 *
 * `X-FrontMCP-Machine-Id` goes on every response a distributed instance sends — the host
 * adapters (Express, web-fetch) add it where their security headers are added, so MCP responses
 * of every protocol revision, health probes, metrics and 404s all carry it. The session flows'
 * hookable `applyNodeHeaders` stage sets it as well, and adds the affinity cookie.
 */

import { buildSetCookie, getEnv, getMachineId, getRuntimeContext } from '@frontmcp/utils';

import { DEFAULT_FRONTMCP_MACHINE_ID_HEADER, DEFAULT_FRONTMCP_NODE_COOKIE } from './ha.constants';

interface HeaderResponse {
  setHeader(name: string, value: string | string[]): unknown;
  getHeader(name: string): unknown;
}

/** The `X-FrontMCP-Machine-Id` header for this instance, or `undefined` outside distributed deployments. */
export function machineIdHeader(): readonly [name: string, value: string] | undefined {
  if (getRuntimeContext().deployment !== 'distributed') return undefined;
  return [DEFAULT_FRONTMCP_MACHINE_ID_HEADER, getMachineId()];
}

/** Set `X-FrontMCP-Machine-Id` on the response. No-op outside distributed deployments. */
export function applyMachineIdHeader(response: Pick<HeaderResponse, 'setHeader'>): boolean {
  const header = machineIdHeader();
  if (!header) return false;
  response.setHeader(header[0], header[1]);
  return true;
}

type SameSite = 'Strict' | 'Lax' | 'None';

/**
 * The affinity cookie's name and attributes. `frontmcp build` turns a deployment's
 * `server.cookies` block (`affinity`, `domain`, `sameSite`) into these variables:
 * FRONTMCP_AFFINITY_COOKIE, FRONTMCP_AFFINITY_COOKIE_DOMAIN, FRONTMCP_AFFINITY_COOKIE_SAMESITE.
 */
export function affinityCookieOptions(): { name: string; domain?: string; sameSite?: SameSite } {
  const name = getEnv('FRONTMCP_AFFINITY_COOKIE')?.trim() || DEFAULT_FRONTMCP_NODE_COOKIE;
  const domain = getEnv('FRONTMCP_AFFINITY_COOKIE_DOMAIN')?.trim() || undefined;
  const rawSameSite = getEnv('FRONTMCP_AFFINITY_COOKIE_SAMESITE')?.trim().toLowerCase();
  const sameSite: SameSite | undefined =
    rawSameSite === 'strict' ? 'Strict' : rawSameSite === 'lax' ? 'Lax' : rawSameSite === 'none' ? 'None' : undefined;
  return { name, ...(domain ? { domain } : {}), ...(sameSite ? { sameSite } : {}) };
}

/** Set the machine-id header plus the node affinity cookie. */
export function applyNodeAffinity(response: HeaderResponse, request: Parameters<typeof buildSetCookie>[1]): void {
  if (!applyMachineIdHeader(response)) return;
  const cookie = buildSetCookie({ ...affinityCookieOptions(), value: getMachineId() }, request);
  if (!cookie) return;
  const existing = response.getHeader('Set-Cookie');
  const existingArr = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  response.setHeader('Set-Cookie', [...existingArr, cookie]);
}
