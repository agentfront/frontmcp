/**
 * What the HTTP upstream does so Claude Code channels reach a bridged stdio session. Claude Code probes a stdio
 * server on MCP 2026-07-28, delivers channel events only to a session started with `initialize`, and never
 * declares the channel capability. The constants mirror `@frontmcp/protocol`, which this package can't import.
 */

import type { JsonRpcFrame } from './stdio-framer';

const PROTOCOL_2026_07_28 = '2026-07-28';
const PROTOCOL_VERSION_META = 'io.modelcontextprotocol/protocolVersion';
const DISCOVER_METHOD = 'server/discover';
const PROTOCOL_20260728_ONLY_METHODS = [DISCOVER_METHOD, 'subscriptions/listen'];
const UNSUPPORTED_PROTOCOL_VERSION = -32022;
const CHANNEL_CAPABILITY = 'claude/channel';

/** The headers a 2026-07-28 `server/discover` must mirror from its body over HTTP. */
export const DISCOVER_HEADERS = { 'mcp-protocol-version': PROTOCOL_2026_07_28, 'mcp-method': DISCOVER_METHOD };

/** What a server says of itself: whether it pushes channels, and the revisions its `initialize` negotiates. */
export interface ServerRevisions {
  pushesChannels: boolean;
  supported: string[];
}

/** The value as an object to read keys of, or `undefined` when it is not one. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** The revision a frame's `_meta` declares, a key that exists only in 2026-07-28. */
function declaredRevision(frame: JsonRpcFrame): string | undefined {
  const declared = recordOf(recordOf(frame.params)?.['_meta'])?.[PROTOCOL_VERSION_META];
  return typeof declared === 'string' ? declared : undefined;
}

/** Whether a client frame belongs to 2026-07-28: its `_meta` declares a revision, or its method exists only there. */
export function namesProtocol20260728(frame: JsonRpcFrame): boolean {
  if (frame.method === undefined) return false;
  return declaredRevision(frame) !== undefined || PROTOCOL_20260728_ONLY_METHODS.includes(frame.method);
}

/** The `-32022` answer to a 2026-07-28 request, naming the revisions the server speaks instead. */
export function unsupportedProtocolVersion(request: JsonRpcFrame, supported: readonly string[]): JsonRpcFrame {
  const requested = declaredRevision(request) ?? PROTOCOL_2026_07_28;
  return {
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: UNSUPPORTED_PROTOCOL_VERSION,
      message: `Unsupported protocol version: ${requested}`,
      data: { supported: [...supported], requested },
    },
  };
}

/** The `server/discover` request the bridge sends for itself, under an id of its own. */
export function discoverRequest(id: string): JsonRpcFrame {
  return {
    jsonrpc: '2.0',
    id,
    method: DISCOVER_METHOD,
    params: { _meta: { [PROTOCOL_VERSION_META]: PROTOCOL_2026_07_28 } },
  };
}

/** Whether a `server/discover` or `initialize` result advertises `experimental['claude/channel']`. */
export function advertisesChannels(result: unknown): boolean {
  const experimental = recordOf(recordOf(recordOf(result)?.['capabilities'])?.['experimental']);
  return experimental?.[CHANNEL_CAPABILITY] !== undefined;
}

/** What a `server/discover` result says of the server; `undefined` when it lists no revisions. */
export function serverRevisionsOf(discoverResult: unknown): ServerRevisions | undefined {
  const supportedVersions = recordOf(discoverResult)?.['supportedVersions'];
  if (!Array.isArray(supportedVersions)) return undefined;
  const supported = supportedVersions.filter(
    (version): version is string => typeof version === 'string' && version !== PROTOCOL_2026_07_28,
  );
  return { pushesChannels: advertisesChannels(discoverResult), supported };
}

/** The client's `initialize` with `experimental['claude/channel']` declared, when it does not declare it itself. */
export function declaringChannels(initialize: JsonRpcFrame): JsonRpcFrame {
  const params = recordOf(initialize.params) ?? {};
  const capabilities = recordOf(params['capabilities']) ?? {};
  const experimental = recordOf(capabilities['experimental']) ?? {};
  if (experimental[CHANNEL_CAPABILITY] !== undefined) return initialize;
  return {
    ...initialize,
    params: {
      ...params,
      capabilities: { ...capabilities, experimental: { ...experimental, [CHANNEL_CAPABILITY]: {} } },
    },
  };
}
