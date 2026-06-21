/**
 * KV-backed last-good bundle cache for managed edge mode.
 *
 * A Cloudflare Worker has no filesystem, so the SaaS bundle source's default
 * on-disk cache (the boot fallback when a fresh pull fails) can't be used.
 * `createKvBundleCache` adapts a Cloudflare **KV namespace** to the generic
 * `BundleCacheStore` contract (`@frontmcp/adapters/skills`) so the last-good
 * bundle survives across isolate restarts and cold starts.
 *
 * ```ts
 * import { createEdgeMcp, createKvBundleCache } from '@frontmcp/edge';
 *
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [],
 *   tasks: { enabled: false },
 *   managed: {
 *     endpoint: env.BUNDLE_ENDPOINT,
 *     authToken: env.PULL_TOKEN,
 *     // ...
 *     cache: createKvBundleCache(env.BUNDLE_CACHE), // KV namespace binding
 *   },
 * });
 * ```
 */

/**
 * Minimal structural subset of the Cloudflare `KVNamespace` binding this cache
 * needs. Declared locally so `@frontmcp/edge` stays free of a hard dependency
 * on `@cloudflare/workers-types` (any runtime exposing this shape works).
 */
export interface EdgeKvNamespace {
  get(key: string, type?: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * A last-good bundle cache. Structurally compatible with the adapters'
 * `BundleCacheStore` — kept local (bundle typed as `unknown`) so the edge
 * package doesn't depend on `@frontmcp/adapters`; the cache only round-trips
 * JSON and never inspects the bundle's shape.
 */
export interface EdgeBundleCacheStore {
  read(): Promise<unknown>;
  write(bundle: unknown): Promise<void>;
}

/** Tuning for {@link createKvBundleCache}. */
export interface KvBundleCacheOptions {
  /** KV key for the serialized last-good bundle. Default `frontmcp:bundle:last-good`. */
  key?: string;
  /** Optional KV TTL (seconds). Omit to persist indefinitely (the usual choice — it's a fallback). */
  expirationTtl?: number;
}

/**
 * Lazily resolve a cache from the per-request Worker `env`. Cloudflare bindings
 * (KV namespaces, etc.) live on the `env` argument passed to `fetch`/`scheduled`
 * — NOT in module scope — so a cache that needs a binding must be built from
 * `env` at request time, not when the module first evaluates.
 */
export type EdgeBundleCacheFactory = (env: unknown) => EdgeBundleCacheStore | undefined;

const DEFAULT_KEY = 'frontmcp:bundle:last-good';

/**
 * Build a {@link EdgeBundleCacheStore} backed by a Cloudflare KV namespace.
 *
 * Reads tolerate a missing key (cold KV) and corrupt JSON by resolving to
 * `undefined` — the source then treats it as "no last-good cache" and surfaces
 * the original pull failure, rather than crashing on a bad cache entry.
 */
export function createKvBundleCache(kv: EdgeKvNamespace, options: KvBundleCacheOptions = {}): EdgeBundleCacheStore {
  const key = options.key ?? DEFAULT_KEY;
  return {
    async read(): Promise<unknown> {
      const raw = await kv.get(key, 'text');
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        // Corrupt cache entry — treat as a miss so a real pull failure is what
        // surfaces, not a JSON parse error.
        return undefined;
      }
    },
    async write(bundle: unknown): Promise<void> {
      const value = JSON.stringify(bundle);
      await kv.put(key, value, options.expirationTtl != null ? { expirationTtl: options.expirationTtl } : undefined);
    },
  };
}

/**
 * Convenience {@link EdgeBundleCacheFactory}: read a KV namespace from
 * `env[binding]` at request time and wrap it as a bundle cache. Pass this as
 * `managed.cache` so the binding is resolved from the Worker's `env` (where CF
 * bindings actually live) instead of at module-eval where it doesn't exist yet.
 *
 * ```ts
 * managed: { …, cache: kvBundleCacheFromEnv('BUNDLE_CACHE') }
 * ```
 *
 * Returns `undefined` (no cache → source uses no fallback) when the binding is
 * absent, rather than throwing — a misconfigured binding shouldn't crash boot.
 */
export function kvBundleCacheFromEnv(binding: string, options?: KvBundleCacheOptions): EdgeBundleCacheFactory {
  return (env: unknown): EdgeBundleCacheStore | undefined => {
    const ns = (env as Record<string, unknown> | undefined)?.[binding];
    if (!ns) return undefined;
    return createKvBundleCache(ns as EdgeKvNamespace, options);
  };
}
