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
import { MCP_20260728_META, type Implementation } from '@frontmcp/protocol';

import { type FlowName, type ScopeEntry } from '../../common';
import { CACHEABLE_METHODS, DEFAULT_CACHE_TTL_MS } from './protocol-20260728.constants';

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
      [MCP_20260728_META.serverInfo]: serverInfo,
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
 *
 * Ordering is guaranteed WITHIN a page. Concatenating paginated pages does not
 * yield a globally sorted list — the cursor defines page boundaries, and this
 * sorts each page as it is returned.
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
 * The flows whose hooks can change each cacheable result for the caller that asked: the list flows,
 * and `skills:filter` for the `skill://` resources and the skill catalog in `server/discover`'s
 * instructions.
 */
const RESULT_SHAPING_FLOWS: Record<string, readonly FlowName[]> = {
  'tools/list': ['tools:list-tools'],
  'resources/list': ['resources:list-resources', 'skills:filter'],
  'resources/templates/list': ['resources:list-resource-templates'],
  'prompts/list': ['prompts:list-prompts'],
  'resources/read': ['resources:read-resource', 'skills:filter'],
  'server/discover': ['skills:filter'],
};

/**
 * Whether a cacheable result may differ from one caller to another, even between anonymous callers.
 *
 * It may when the scope evaluates `authorities` rules, which filter lists and gate reads for the
 * caller, or when any hook runs in a flow that builds the result: feature flags, skill visibility
 * and custom filters all decide there, for the caller. Methods not listed count as per-caller.
 */
export function isShapedPerCaller(scope: Pick<ScopeEntry, 'hooks' | 'authoritiesEngine'>, method: string): boolean {
  if (scope.authoritiesEngine) return true;
  const flows = RESULT_SHAPING_FLOWS[method];
  if (!flows) return true;
  return flows.some((flow) => scope.hooks.getFlowHooks(flow).length > 0);
}

/**
 * Choose a cache scope for a request.
 *
 * `public` lets a shared cache serve the result to every caller, so it is used only for an anonymous
 * request whose result nothing shaped per caller (see {@link isShapedPerCaller}). Anything tied to a
 * token, or filtered for the caller, is `private` so intermediaries cannot cross authorization
 * contexts. Without `shapedPerCaller`, the result is treated as shaped per caller.
 */
export function resolveCacheScope(isAnonymous: boolean, shapedPerCaller = true): 'public' | 'private' {
  return isAnonymous && !shapedPerCaller ? 'public' : 'private';
}
