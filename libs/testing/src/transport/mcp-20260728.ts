/**
 * @file mcp-20260728.ts
 * @description The wire format of MCP protocol revision 2026-07-28: per-request `_meta` and mirrored headers
 */

import {
  MCP_20260728_ADDED_METHODS,
  PROTOCOL_2026_07_28,
  SUBSCRIPTIONS_ACKNOWLEDGED_METHOD,
  type SubscriptionFilter,
} from '@frontmcp/protocol';
import { base64Encode } from '@frontmcp/utils';

import type { JsonRpcRequest, JsonRpcResponse } from './transport.interface';

const SENTINEL_PREFIX = '=?base64?';
const SENTINEL_SUFFIX = '?=';
const NAME_PARAM_BY_METHOD: Record<string, string> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'events/poll': 'name',
  'events/stream': 'name',
  'events/subscribe': 'name',
  'events/unsubscribe': 'name',
};

/** Whether a request travels as 2026-07-28: the client speaks it, or the method exists only in it. */
export function isStatelessRequest(protocolVersion: string | undefined, method: string | undefined): boolean {
  if (protocolVersion === PROTOCOL_2026_07_28) return true;
  return (MCP_20260728_ADDED_METHODS as readonly string[]).includes(method ?? '');
}

/** A header value, Base64-wrapped in the `=?base64?…?=` sentinel when it isn't plain visible ASCII. */
export function encodeHeaderValue(value: string): string {
  const needsEncoding = /[^\x20-\x7e]/.test(value) || value !== value.trim() || value.startsWith(SENTINEL_PREFIX);
  if (!needsEncoding) return value;
  return `${SENTINEL_PREFIX}${base64Encode(new TextEncoder().encode(value))}${SENTINEL_SUFFIX}`;
}

/** The request with the client's `_meta` added; keys the caller set in `_meta` win. */
export function withRequestMeta(message: JsonRpcRequest, meta: Record<string, unknown>): JsonRpcRequest {
  const params = message.params ?? {};
  const callerMeta = params['_meta'] as Record<string, unknown> | undefined;
  return { ...message, params: { ...params, _meta: { ...meta, ...callerMeta } } };
}

/** The headers a 2026-07-28 request mirrors from its body. `toolInputSchema` is the called tool's, when known. */
export function revisionHeaders(
  message: JsonRpcRequest | undefined,
  toolInputSchema?: unknown,
): Record<string, string> {
  const headers: Record<string, string> = { 'MCP-Protocol-Version': PROTOCOL_2026_07_28 };
  if (!message) return headers;
  headers['Mcp-Method'] = message.method;

  const nameParam = NAME_PARAM_BY_METHOD[message.method];
  const name = nameParam ? message.params?.[nameParam] : undefined;
  if (typeof name === 'string') headers['Mcp-Name'] = encodeHeaderValue(name);

  if (message.method === 'tools/call') {
    Object.assign(headers, paramHeaders(toolInputSchema, message.params?.['arguments']));
  }
  return headers;
}

/** `Mcp-Param-{Name}` for each argument the schema annotates with `x-mcp-header` and the call passes. */
function paramHeaders(schema: unknown, args: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
  const values = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};

  for (const [key, property] of Object.entries(properties)) {
    const value = values[key];
    const headerName = (property as Record<string, unknown> | null)?.['x-mcp-header'];
    if (typeof headerName === 'string' && headerName && isHeaderValue(value)) {
      headers[`Mcp-Param-${headerName}`] = encodeHeaderValue(String(value));
    }
    Object.assign(headers, paramHeaders(property, value));
  }
  return headers;
}

function isHeaderValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || Number.isSafeInteger(value);
}

/** The JSON-RPC error an HTTP error's body carries, if it carries one. */
export function jsonRpcErrorIn(body: string): JsonRpcResponse | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<JsonRpcResponse>;
    const error = parsed.error;
    if (typeof error?.code !== 'number' || typeof error.message !== 'string') return undefined;
    return { jsonrpc: '2.0', id: parsed.id ?? null, error };
  } catch {
    return undefined;
  }
}

/** The filter a `notifications/subscriptions/acknowledged` event acknowledges, or undefined for any other event. */
export function acknowledgedFilterIn(eventData: string): SubscriptionFilter | undefined {
  try {
    const message = JSON.parse(eventData) as { method?: unknown; params?: { notifications?: SubscriptionFilter } };
    if (message.method !== SUBSCRIPTIONS_ACKNOWLEDGED_METHOD) return undefined;
    return message.params?.notifications ?? {};
  } catch {
    return undefined;
  }
}
