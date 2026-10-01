/**
 * Load-balancer affinity headers for distributed deployments.
 *
 * `X-FrontMCP-Machine-Id` goes on every response a distributed instance sends — the host
 * adapters (Express, web-fetch) add it where their security headers are added, so MCP responses
 * of every protocol revision, health probes, metrics and 404s all carry it. The session flows'
 * hookable `applyNodeHeaders` stage sets it as well, and adds the affinity cookie.
 */

import { buildSetCookie, getMachineId, getRuntimeContext } from '@frontmcp/utils';

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

/** Set the machine-id header plus the node affinity cookie. */
export function applyNodeAffinity(response: HeaderResponse, request: Parameters<typeof buildSetCookie>[1]): void {
  if (!applyMachineIdHeader(response)) return;
  const cookie = buildSetCookie({ name: DEFAULT_FRONTMCP_NODE_COOKIE, value: getMachineId() }, request);
  if (!cookie) return;
  const existing = response.getHeader('Set-Cookie');
  const existingArr = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  response.setHeader('Set-Cookie', [...existingArr, cookie]);
}
