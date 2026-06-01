/**
 * Token-storage adapter factory
 *
 * Builds a `StorageAdapter` (from `@frontmcp/utils`) from an auth
 * {@link TokenStorageConfig}, so the local-mode auth stores (authorization
 * codes/tokens, federated-auth sessions, orchestrated provider tokens) can be
 * backed by memory, Redis, or local SQLite using one consistent adapter.
 *
 * Dependency direction (per CLAUDE.md):
 * - `@frontmcp/utils` stays storage-backend-agnostic and MUST NOT depend on
 *   `@frontmcp/storage-sqlite`.
 * - The SQLite knowledge lives here, in the auth layer, via a lazy
 *   `require('@frontmcp/storage-sqlite')` — mirroring how the SDK's
 *   `session-store.factory.ts` lazy-loads the SQLite session store. This keeps
 *   `ioredis`/`better-sqlite3` out of bundles that don't use them.
 */

import { MemoryStorageAdapter, RedisStorageAdapter, type StorageAdapter } from '@frontmcp/utils';

import { type TokenStorageConfig, type TokenStorageSqliteConfig } from '../options/interfaces';
import { type RedisConfig } from './transport-session.types';

/**
 * Narrow a {@link TokenStorageConfig} to its Redis variant.
 */
export function isRedisTokenStorage(config: TokenStorageConfig | undefined): config is { redis: RedisConfig } {
  return typeof config === 'object' && config !== null && 'redis' in config && !!config.redis;
}

/**
 * Narrow a {@link TokenStorageConfig} to its SQLite variant.
 */
export function isSqliteTokenStorage(
  config: TokenStorageConfig | undefined,
): config is { sqlite: TokenStorageSqliteConfig } {
  return typeof config === 'object' && config !== null && 'sqlite' in config && !!config.sqlite;
}

/**
 * Whether a token-storage config persists across process restarts.
 * `'memory'` (and the undefined default) do not; Redis and SQLite do.
 */
export function isPersistentTokenStorage(config: TokenStorageConfig | undefined): boolean {
  return config !== undefined && config !== 'memory';
}

/**
 * Create and connect a `StorageAdapter` for the given token-storage config.
 *
 * @param config - Token storage configuration. `'memory'` (or `undefined`)
 *   yields an in-memory adapter; `{ redis }` a Redis adapter; `{ sqlite }` a
 *   SQLite-file adapter.
 * @returns A connected `StorageAdapter`.
 */
export async function createTokenStorageAdapter(config: TokenStorageConfig | undefined): Promise<StorageAdapter> {
  // memory (default)
  if (config === undefined || config === 'memory') {
    const adapter = new MemoryStorageAdapter();
    await adapter.connect();
    return adapter;
  }

  // sqlite — lazy require to avoid bundling better-sqlite3 when unused.
  if (isSqliteTokenStorage(config)) {
    const { SqliteStorageAdapter } = require('@frontmcp/storage-sqlite') as typeof import('@frontmcp/storage-sqlite');
    const adapter: StorageAdapter = new SqliteStorageAdapter({
      path: config.sqlite.path,
      encryption: config.sqlite.encryption,
      ttlCleanupIntervalMs: config.sqlite.ttlCleanupIntervalMs ?? 60000,
      walMode: config.sqlite.walMode ?? true,
    });
    await adapter.connect();
    return adapter;
  }

  // redis
  if (isRedisTokenStorage(config)) {
    const { host, port, password, db, tls, keyPrefix } = config.redis;
    const adapter = new RedisStorageAdapter({
      config: { host, port, password, db, tls },
      keyPrefix: keyPrefix ?? '',
    });
    await adapter.connect();
    return adapter;
  }

  // Should be unreachable given the union; fall back to memory defensively.
  const fallback = new MemoryStorageAdapter();
  await fallback.connect();
  return fallback;
}
