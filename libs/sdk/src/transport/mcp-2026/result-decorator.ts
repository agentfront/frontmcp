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
}

/** Attach the 2026-07-28 envelope fields to a handler's raw result. */
export function decorateResult(
  result: Record<string, unknown>,
  options: DecorateResultOptions,
): Record<string, unknown> {
  const { method, serverInfo, cacheScope = 'private', ttlMs } = options;

  const existingMeta = (result['_meta'] as Record<string, unknown> | undefined) ?? {};
  const decorated: Record<string, unknown> = {
    ...result,
    // A handler that already produced an interim result (MRTR) keeps its own
    // discriminator; everything else is a completed result.
    resultType: typeof result['resultType'] === 'string' ? result['resultType'] : 'complete',
    _meta: {
      ...existingMeta,
      [MCP_2026_META.serverInfo]: serverInfo,
    },
  };

  if (CACHEABLE_METHODS.includes(method)) {
    decorated['ttlMs'] = ttlMs ?? DEFAULT_CACHE_TTL_MS[method] ?? 0;
    decorated['cacheScope'] = cacheScope;
  }

  return decorated;
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
