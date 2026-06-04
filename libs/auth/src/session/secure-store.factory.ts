/**
 * Secure-store backend factory (#470).
 *
 * Builds a {@link SecureStoreBackend} from an `auth.secureStore`
 * {@link SecureStoreConfig}, mirroring {@link createTokenStorageAdapter}'s
 * selection pattern:
 *
 * - `'memory'` / object-without-backing → in-memory `StorageAdapter` wrapped in
 *   the AES-256-GCM-encrypted {@link EncryptedStorageSecureStoreBackend}.
 * - `{ sqlite }` / `{ redis }` → persistent `StorageAdapter` (via
 *   {@link createTokenStorageAdapter}) wrapped in the same encrypted backend.
 * - `{ backend }` → the user-supplied custom backing is used AS-IS (e.g. an OS
 *   keychain). The framework bundles NO native dependency for this path.
 *
 * The dependency direction matches the CLAUDE.md storage-factory pattern: SQLite
 * is reached lazily through `createTokenStorageAdapter`, so `better-sqlite3` /
 * `ioredis` stay out of bundles that don't use them.
 */

import { MemoryStorageAdapter, type StorageAdapter } from '@frontmcp/utils';

import { type AuthLogger } from '../common/auth-logger.interface';
import { type SecureStoreConfig, type TokenStorageConfig, type TokenStorageSqliteConfig } from '../options/interfaces';
import { type SecureStoreBackend, type SecureStoreScope } from './secure-store';
import { EncryptedStorageSecureStoreBackend } from './secure-store-backends';
import { createTokenStorageAdapter } from './token-storage.factory';
import { type RedisConfig } from './transport-session.types';

/** The backing kind a {@link SecureStoreConfig} resolves to. */
export type SecureStoreBackendKind = 'memory' | 'sqlite' | 'redis' | 'custom';

/**
 * Resolved view of a {@link SecureStoreConfig}: the constructed backend, the
 * namespace scope, the default TTL, and the backing kind (for diagnostics).
 */
export interface ResolvedSecureStore {
  backend: SecureStoreBackend;
  scope: SecureStoreScope;
  ttlMs?: number;
  kind: SecureStoreBackendKind;
}

/**
 * Options for {@link createSecureStore}.
 */
export interface CreateSecureStoreOptions {
  /** The `auth.secureStore` config. `undefined` → in-memory default. */
  config: SecureStoreConfig | undefined;
  /**
   * Master pepper for the built-in encrypted backings. Used when the config
   * does not carry an explicit `encryption.pepper`. Typically the server
   * JWT/VAULT secret.
   */
  pepper?: string;
  /**
   * Optionally reuse an already-connected adapter for the built-in encrypted
   * backing instead of building one from the config. When provided, the
   * sqlite/redis selection is NOT used to build an adapter (it still informs the
   * reported `kind`). Ignored for the `{ backend }` (custom) path.
   */
  storage?: StorageAdapter;
  /** Scoped logger. */
  logger?: AuthLogger;
}

/** Narrow a {@link SecureStoreConfig} to its custom-backend variant. */
function isCustomBackendConfig(
  config: SecureStoreConfig | undefined,
): config is { backend: SecureStoreBackend } & { scope?: SecureStoreScope; ttlMs?: number } {
  return typeof config === 'object' && config !== null && 'backend' in config && !!config.backend;
}

/** Narrow a {@link SecureStoreConfig} to its SQLite variant. */
function isSqliteConfig(
  config: SecureStoreConfig | undefined,
): config is { sqlite: TokenStorageSqliteConfig } & { scope?: SecureStoreScope; ttlMs?: number } {
  return typeof config === 'object' && config !== null && 'sqlite' in config && !!config.sqlite;
}

/** Narrow a {@link SecureStoreConfig} to its Redis variant. */
function isRedisConfig(
  config: SecureStoreConfig | undefined,
): config is { redis: RedisConfig } & { scope?: SecureStoreScope; ttlMs?: number } {
  return typeof config === 'object' && config !== null && 'redis' in config && !!config.redis;
}

/** Read the namespace scope off a config (object forms only), defaulting to `user`. */
function readScope(config: SecureStoreConfig | undefined): SecureStoreScope {
  if (typeof config === 'object' && config !== null && 'scope' in config && config.scope) {
    return config.scope;
  }
  return 'user';
}

/** Read the default TTL off a config (object forms only). */
function readTtlMs(config: SecureStoreConfig | undefined): number | undefined {
  if (typeof config === 'object' && config !== null && 'ttlMs' in config) {
    return config.ttlMs;
  }
  return undefined;
}

/** Read the pepper override off a config's `encryption` block (object forms only). */
function readPepper(config: SecureStoreConfig | undefined): string | undefined {
  if (typeof config === 'object' && config !== null && 'encryption' in config && config.encryption) {
    return config.encryption.pepper;
  }
  return undefined;
}

/**
 * Map a {@link SecureStoreConfig} onto a {@link TokenStorageConfig} so the
 * shared {@link createTokenStorageAdapter} can build the backing adapter for the
 * built-in encrypted backings.
 */
function toTokenStorageConfig(config: SecureStoreConfig | undefined): TokenStorageConfig {
  if (isSqliteConfig(config)) {
    return { sqlite: config.sqlite };
  }
  if (isRedisConfig(config)) {
    return { redis: config.redis };
  }
  return 'memory';
}

/**
 * Create a {@link SecureStoreBackend} (plus resolved scope/ttl/kind) for the
 * given `auth.secureStore` config.
 */
export async function createSecureStore(options: CreateSecureStoreOptions): Promise<ResolvedSecureStore> {
  const { config, pepper, storage, logger } = options;
  const scope = readScope(config);
  const ttlMs = readTtlMs(config);

  // Custom backing (e.g. OS keychain): use as-is, no adapter, no framework crypto.
  if (isCustomBackendConfig(config)) {
    return { backend: config.backend, scope, ttlMs, kind: 'custom' };
  }

  // Built-in encrypted backing over a StorageAdapter (memory / sqlite / redis).
  const kind: SecureStoreBackendKind = isSqliteConfig(config) ? 'sqlite' : isRedisConfig(config) ? 'redis' : 'memory';

  let adapter: StorageAdapter;
  if (storage) {
    adapter = storage;
  } else if (kind === 'memory') {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
  } else {
    adapter = await createTokenStorageAdapter(toTokenStorageConfig(config));
  }

  const backend = new EncryptedStorageSecureStoreBackend({
    storage: adapter,
    pepper: readPepper(config) ?? pepper,
    logger,
  });

  return { backend, scope, ttlMs, kind };
}
