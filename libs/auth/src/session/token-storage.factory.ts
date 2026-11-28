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
 *   `ioredis`/`better-sqlite3` out of bundles that don't use them. A bundle that
 *   contains the package hands it over with `registerOptionalModule()` instead.
 */

import {
  isRedisConnection,
  MemoryStorageAdapter,
  redisAdapterOptionsOf,
  RedisStorageAdapter,
  requireOptionalModule,
  StorageConfigError,
  type StorageAdapter,
} from '@frontmcp/utils';

import { type TokenStorageConfig, type TokenStorageSqliteConfig } from '../options/interfaces';
import { type AuthorizationKeyHashSecret } from './authorization-row-names';
import { type RedisConfig } from './transport-session.types';

/**
 * Narrow a {@link TokenStorageConfig} to its Redis variant: a connection in any form (host, url,
 * cluster, or a client you made; see `isRedisConnection()`).
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
 * The secret the authorization store names its rows with (`StorageAuthorizationStoreOptions.keyHashSecret`): the
 * SQLite `encryption.secret` when the token storage has one, since it already guards that file and stays the same
 * for as long as the file can be read; otherwise `serverSecret`, the server's `JWT_SECRET`, which every instance
 * sharing the storage holds. Undefined when neither is set, and the rows are then named under a fixed key.
 *
 * A one-off `StorageAuthorizationStore.moveLegacyRows()` passes the same values the server uses, so the rows it
 * moves are found.
 */
export function tokenStorageKeyHashSecret(
  config: TokenStorageConfig | undefined,
  serverSecret?: AuthorizationKeyHashSecret,
): AuthorizationKeyHashSecret | undefined {
  const encryptionSecret = isSqliteTokenStorage(config) ? config.sqlite.encryption?.secret : undefined;
  if (encryptionSecret) return encryptionSecret;
  // A blank JWT_SECRET is no secret: the server signs with a random one then, as it does here.
  if (typeof serverSecret === 'string') return serverSecret.trim() ? serverSecret : undefined;
  return serverSecret && serverSecret.length > 0 ? serverSecret : undefined;
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
    const { SqliteStorageAdapter } = requireOptionalModule(
      '@frontmcp/storage-sqlite',
      () => require('@frontmcp/storage-sqlite') as typeof import('@frontmcp/storage-sqlite'),
    );
    const adapter: StorageAdapter = new SqliteStorageAdapter({
      path: config.sqlite.path,
      encryption: config.sqlite.encryption,
      ttlCleanupIntervalMs: config.sqlite.ttlCleanupIntervalMs ?? 60000,
      walMode: config.sqlite.walMode ?? true,
      busyTimeoutMs: config.sqlite.busyTimeoutMs,
    });
    await adapter.connect();
    return adapter;
  }

  // redis
  if (isRedisTokenStorage(config)) {
    if (!isRedisConnection(config.redis)) {
      throw new StorageConfigError('redis', 'tokenStorage.redis needs host, url, cluster.nodes or client');
    }
    const adapter = new RedisStorageAdapter({
      ...redisAdapterOptionsOf(config.redis),
      keyPrefix: config.redis.keyPrefix ?? '',
    });
    await adapter.connect();
    return adapter;
  }

  // Should be unreachable given the union; fall back to memory defensively.
  const fallback = new MemoryStorageAdapter();
  await fallback.connect();
  return fallback;
}
