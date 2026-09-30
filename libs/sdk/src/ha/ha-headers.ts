/**
 * Load-balancer affinity headers for distributed deployments.
 *
 * Applied from flow stages so plugins can hook or replace them.
 */

import { buildSetCookie, getMachineId, getRuntimeContext } from '@frontmcp/utils';

import { DEFAULT_FRONTMCP_MACHINE_ID_HEADER, DEFAULT_FRONTMCP_NODE_COOKIE } from './ha.constants';

interface HeaderResponse {
  setHeader(name: string, value: string | string[]): unknown;
  getHeader(name: string): unknown;
}

/** Set `X-FrontMCP-Machine-Id` on the response. No-op outside distributed deployments. */
export function applyMachineIdHeader(response: HeaderResponse): boolean {
  if (getRuntimeContext().deployment !== 'distributed') return false;
  response.setHeader(DEFAULT_FRONTMCP_MACHINE_ID_HEADER, getMachineId());
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
