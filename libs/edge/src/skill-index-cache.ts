/**
 * KV-backed cache for the skill SEARCH INDEX (the TF-IDF / BM25 "embedding"
 * model + per-skill vectors), for fast cold starts on Cloudflare Workers.
 *
 * Building the index means tokenizing every skill, computing IDF across the
 * corpus, and embedding each document — work a long-lived server pays once but a
 * Worker would otherwise repeat on EVERY cold start. This adapter persists the
 * built index snapshot to a Cloudflare **KV namespace** (keyed by a content hash
 * of the indexed skills), so a cold start restores it instead of recomputing.
 *
 * ```ts
 * import { createEdgeMcp } from '@frontmcp/edge';
 *
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [MyApp],
 *   tasks: { enabled: false },
 *   skillIndex: { binding: 'FRONTMCP_SKILL_INDEX' }, // KV namespace binding
 * });
 * ```
 */
import type { SkillIndexCache } from '@frontmcp/sdk';

import type { EdgeKvNamespace } from './kv-cache';

/** Default KV key prefix for skill-index snapshots. */
const DEFAULT_KEY_PREFIX = 'frontmcp:skill-index:';

/** Tuning for {@link createKvSkillIndexCache}. */
export interface KvSkillIndexCacheOptions {
  /** KV key prefix for snapshots. The content hash is appended. Default `frontmcp:skill-index:`. */
  keyPrefix?: string;
  /** Optional KV TTL (seconds). Omit to persist indefinitely. */
  expirationTtl?: number;
}

/**
 * Lazily resolve a skill-index cache from the per-request Worker `env`. CF
 * bindings (KV namespaces) live on `env`, not module scope, so a cache that
 * needs a binding must be built from `env` at request time.
 */
export type EdgeSkillIndexCacheFactory = (env: unknown) => SkillIndexCache | undefined;

/**
 * Build a {@link SkillIndexCache} backed by a Cloudflare KV namespace.
 *
 * Reads tolerate a missing key (cold KV) and corrupt JSON by resolving to
 * `undefined` (a miss → rebuild). Writes are best-effort: a KV write failure is
 * swallowed so a persist error never fails search.
 */
export function createKvSkillIndexCache(kv: EdgeKvNamespace, options: KvSkillIndexCacheOptions = {}): SkillIndexCache {
  const prefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  return {
    async get(key: string): Promise<unknown> {
      const raw = await kv.get(prefix + key, 'text');
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(key: string, snapshot: unknown): Promise<void> {
      const value = JSON.stringify(snapshot);
      await kv.put(prefix + key, value, options.expirationTtl != null ? { expirationTtl: options.expirationTtl } : undefined);
    },
  };
}

/**
 * Convenience {@link EdgeSkillIndexCacheFactory}: read a KV namespace from
 * `env[binding]` at request time and wrap it. Returns `undefined` when the
 * binding is absent (caching is simply skipped — search still works), rather
 * than throwing, so a missing binding never bricks boot.
 */
export function kvSkillIndexCacheFromEnv(
  binding: string,
  options?: KvSkillIndexCacheOptions,
): EdgeSkillIndexCacheFactory {
  return (env: unknown): SkillIndexCache | undefined => {
    const ns = (env as Record<string, unknown> | undefined)?.[binding];
    if (!ns) return undefined;
    return createKvSkillIndexCache(ns as EdgeKvNamespace, options);
  };
}
