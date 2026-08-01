/**
 * Result shaping for protocol 2026-07-28.
 *
 * Three additions ride on every response of this revision:
 * - `resultType` — REQUIRED on all results, so the client can tell a final
 *   result from an MRTR interim one without guessing.
 * - `_meta["io.modelcontextprotocol/serverInfo"]` — the identity that used to
 *   arrive once via `initialize`.
 * - `ttlMs` + `cacheScope` — REQUIRED on `CacheableResult` methods only.
 *
 * Applied at the dispatcher boundary rather than inside each handler, so the
 * existing handlers (shared with every older transport) stay untouched and no
 * legacy response can accidentally grow these fields.
 */
import { MCP_2026_META, type Implementation } from '@frontmcp/protocol';

import { CACHEABLE_METHODS, DEFAULT_CACHE_TTL_MS } from './protocol-2026.constants';

export interface DecorateResultOptions {
  /** JSON-RPC method that produced this result. */
  method: string;
  /** Server identity advertised back to the client. */
  serverInfo: Implementation;
  /**
   * `private` when the payload may vary by authorization context, `public` when
   * it is identical for every caller. Getting this wrong lets a shared proxy
   * serve one tenant's tool list to another, so the default is `private`.
   */
  cacheScope?: 'public' | 'private';
  /** Override for the per-method TTL default. */
  ttlMs?: number;
  /**
   * OpenTelemetry context to echo back (SEP-414).
   *
   * Propagating `traceparent` on the response lets a client stitch its span to
   * the server's without an out-of-band correlation id.
   */
  traceContext?: Record<string, string>;
}

/** Attach the 2026-07-28 envelope fields to a handler's raw result. */
export function decorateResult(
  result: Record<string, unknown>,
  options: DecorateResultOptions,
): Record<string, unknown> {
  const { method, serverInfo, cacheScope = 'private', ttlMs, traceContext } = options;

  const existingMeta = (result['_meta'] as Record<string, unknown> | undefined) ?? {};
  const decorated: Record<string, unknown> = {
    ...result,
    // A handler that already produced an interim result (MRTR) keeps its own
    // discriminator; everything else is a completed result.
    resultType: typeof result['resultType'] === 'string' ? result['resultType'] : 'complete',
    _meta: {
      ...existingMeta,
      ...(traceContext ?? {}),
      [MCP_2026_META.serverInfo]: serverInfo,
    },
  };

  if (CACHEABLE_METHODS.includes(method)) {
    decorated['ttlMs'] = ttlMs ?? DEFAULT_CACHE_TTL_MS[method] ?? 0;
    decorated['cacheScope'] = cacheScope;
  }

  return decorated;
}

/** List results whose entries this revision asks servers to order deterministically. */
const ORDERED_LIST_FIELDS: Record<string, string> = {
  'tools/list': 'tools',
  'prompts/list': 'prompts',
  'resources/list': 'resources',
  'resources/templates/list': 'resourceTemplates',
};

/**
 * Sort list entries by name so repeated calls agree byte-for-byte.
 *
 * 2026-07-28 asks servers to return `tools/list` in a deterministic order so
 * clients can cache and so an LLM's prompt cache keeps hitting. Registration
 * order is already stable in practice, but it shifts the moment a tool is
 * registered dynamically — sorting makes the guarantee explicit.
 *
 * Applied only on the 2026 path; older revisions keep their existing order.
 */
export function orderListResult(method: string, result: Record<string, unknown>): Record<string, unknown> {
  const field = ORDERED_LIST_FIELDS[method];
  if (!field) return result;

  const entries = result[field];
  if (!Array.isArray(entries)) return result;

  const sorted = [...entries].sort((a, b) => {
    const left = String((a as { name?: unknown; uri?: unknown })?.name ?? (a as { uri?: unknown })?.uri ?? '');
    const right = String((b as { name?: unknown; uri?: unknown })?.name ?? (b as { uri?: unknown })?.uri ?? '');
    return left < right ? -1 : left > right ? 1 : 0;
  });

  return { ...result, [field]: sorted };
}

/**
 * Choose a cache scope for a request.
 *
 * Anonymous/public traffic carries no per-user variation and is safe to share;
 * anything tied to a token is `private` so intermediaries cannot cross
 * authorization contexts.
 */
export function resolveCacheScope(isAnonymous: boolean): 'public' | 'private' {
  return isAnonymous ? 'public' : 'private';
}
