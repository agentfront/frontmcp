/**
 * Constants for MCP protocol revision 2026-07-28.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/changelog
 */
import { PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

/**
 * Every revision this server speaks, newest first.
 *
 * Advertised verbatim by `server/discover` and echoed in the `supported` array
 * of an `UnsupportedProtocolVersionError`. The older entries are load-bearing:
 * dropping one would strand every client that negotiated it.
 */
export const FRONTMCP_SUPPORTED_PROTOCOL_VERSIONS = [
  PROTOCOL_2026_07_28,
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

/**
 * Revisions handled by the pre-existing session/`initialize` pipeline.
 *
 * A request declaring one of these is NOT claimed by the 2026 path, which is
 * what keeps the old behaviour bit-for-bit identical.
 */
export const LEGACY_PROTOCOL_VERSIONS = ['2024-10-07', '2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

/** Methods that exist only in 2026-07-28. */
export const PROTOCOL_20260728_ONLY_METHODS = ['server/discover', 'subscriptions/listen'];

/** HTTP header names mirrored from the JSON-RPC body (SEP-2243). */
export const MCP_HEADERS = {
  protocolVersion: 'mcp-protocol-version',
  method: 'mcp-method',
  name: 'mcp-name',
  /** Prefix for `x-mcp-header`-derived parameter headers. */
  paramPrefix: 'mcp-param-',
} as const;

/** Methods whose `Mcp-Name` header is sourced from `params.name`. */
export const NAME_FROM_PARAMS_NAME = ['tools/call', 'prompts/get'];

/** Methods whose `Mcp-Name` header is sourced from `params.uri`. */
export const NAME_FROM_PARAMS_URI = ['resources/read'];

/**
 * Default `ttlMs` per cacheable method.
 *
 * Conservative on purpose: list endpoints change rarely and benefit most from
 * caching, while `resources/read` is content that a server may regenerate, so
 * it defaults to "revalidate every time" rather than risking a stale read.
 */
export const DEFAULT_CACHE_TTL_MS: Record<string, number> = {
  'server/discover': 300_000,
  'tools/list': 60_000,
  'prompts/list': 60_000,
  'resources/list': 60_000,
  'resources/templates/list': 60_000,
  'resources/read': 0,
};

/** Methods whose results MUST carry `ttlMs` + `cacheScope` (`CacheableResult`). */
export const CACHEABLE_METHODS = Object.keys(DEFAULT_CACHE_TTL_MS);

/**
 * MCP extensions this server advertises under `capabilities.extensions`.
 *
 * Keys follow the `_meta` naming rules (mandatory reverse-DNS prefix).
 */
export const ADVERTISED_EXTENSIONS: Record<string, Record<string, unknown>> = {
  'io.modelcontextprotocol/tasks': {},
};
