/**
 * Elicitation Store Factory
 *
 * Factory functions for creating elicitation stores using @frontmcp/utils storage.
 * Supports Memory, Redis, and Upstash backends with automatic detection.
 *
 * Note: Vercel KV is NOT supported for elicitation because it doesn't support pub/sub
 * operations which are required for cross-node result routing.
 *
 * @module elicitation/store/elicitation-store.factory
 */

import type { StorageConfig, RootStorage, RedisAdapterOptions } from '@frontmcp/utils';
import { createStorage, createMemoryStorage } from '@frontmcp/utils';
import type { FrontMcpLogger, RedisOptionsInput } from '../../common';
import type { ElicitationStore } from './elicitation.store';
import { StorageElicitationStore } from './storage-elicitation.store';
import { ElicitationNotSupportedError } from '../../errors/elicitation.error';

/**
 * Options for creating an elicitation store.
 */
export interface ElicitationStoreOptions {
  /**
   * Storage configuration for the elicitation store.
   * Uses @frontmcp/utils storage configuration format.
   *
   * @example Auto-detect
   * ```typescript
   * { type: 'auto' }
   * ```
   *
   * @example Redis
   * ```typescript
   * {
   *   type: 'redis',
   *   redis: { url: 'redis://localhost:6379' }
   * }
   * ```
   *
   * @example Upstash
   * ```typescript
   * {
   *   type: 'upstash',
   *   upstash: { enablePubSub: true }
   * }
   * ```
   */
  storage?: StorageConfig;

  /**
   * Redis configuration for distributed deployments.
   * This is a convenience option that maps to storage.redis.
   * For new code, prefer using the `storage` option directly.
   */
  redis?: RedisOptionsInput;

  /**
   * Key prefix for all elicitation keys.
   * @default 'mcp:elicit:'
   */
  keyPrefix?: string;

  /**
   * Logger instance for store operations.
   */
  logger?: FrontMcpLogger;

  /**
   * Whether running in Edge runtime (requires distributed storage).
   * @default false
   */
  isEdgeRuntime?: boolean;

  /**
   * Whether to require pub/sub support.
   * If true, will throw if the storage backend doesn't support pub/sub.
   * @default true
   */
  requiresPubSub?: boolean;
}

/**
 * Result of creating an elicitation store.
 */
export interface ElicitationStoreResult {
  /**
   * The created elicitation store.
   */
  store: ElicitationStore;

  /**
   * The type of storage backend used.
   */
  type: 'memory' | 'redis' | 'upstash' | 'auto';

  /**
   * The underlying storage instance.
   * Available for advanced use cases.
   */
  storage: RootStorage;
}

/**
 * Detect storage type from environment or config.
 */
function detectStorageType(storage: RootStorage): 'memory' | 'redis' | 'upstash' | 'auto' {
  // Check environment variables to infer type
  if (process.env['UPSTASH_REDIS_REST_URL']) {
    return 'upstash';
  }
  if (process.env['REDIS_URL'] || process.env['REDIS_HOST']) {
    return 'redis';
  }
  return 'memory';
}

/**
 * Create an elicitation store based on configuration.
 *
 * Uses @frontmcp/utils storage abstractions for unified backend support.
 *
 * @param options - Store configuration
 * @returns The created elicitation store with type information
 *
 * @example Auto-detect (recommended)
 * ```typescript
 * const { store, type } = await createElicitationStore({
 *   keyPrefix: 'myapp:elicit:',
 *   logger,
 * });
 * ```
 *
 * @example Redis
 * ```typescript
 * const { store, type } = await createElicitationStore({
 *   storage: {
 *     type: 'redis',
 *     redis: { url: 'redis://localhost:6379' },
 *   },
 *   logger,
 * });
 * ```
 *
 * @example Memory (development)
 * ```typescript
 * const { store, type } = await createElicitationStore({
 *   storage: { type: 'memory' },
 *   logger,
 * });
 * ```
 *
 * @throws {ElicitationNotSupportedError} If Vercel KV is configured (no pub/sub support)
 * @throws {ElicitationNotSupportedError} If running on Edge runtime without distributed storage
 * @throws {ElicitationNotSupportedError} If pub/sub is required but not supported
 */
export async function createElicitationStore(options: ElicitationStoreOptions = {}): Promise<ElicitationStoreResult> {
  const {
    storage: storageConfig,
    redis,
    keyPrefix = 'mcp:elicit:',
    logger,
    isEdgeRuntime = false,
    requiresPubSub = true,
  } = options;

  // Build final storage config, merging redis option if provided
  let finalStorageConfig: StorageConfig | undefined = storageConfig;

  // Handle legacy redis option - convert to storage config
  if (redis && !storageConfig) {
    // Check for Vercel KV provider (not supported)
    if ('provider' in redis && redis.provider === 'vercel-kv') {
      throw new ElicitationNotSupportedError(
        'Vercel KV is not supported for elicitation stores. ' +
          'Elicitation requires pub/sub for cross-node result routing, which Vercel KV does not support. ' +
          'Use Redis provider instead: { provider: "redis", host: "...", port: ... }',
      );
    }

    // Convert redis option to storage config
    const isNewRedisFormat = 'provider' in redis && redis.provider === 'redis' && 'host' in redis;
    const isLegacyRedisFormat = !('provider' in redis) && 'host' in redis && typeof redis.host === 'string';

    if (isNewRedisFormat || isLegacyRedisFormat) {
      const redisHost = (redis as { host: string }).host;
      const redisPort = (redis as { port?: number }).port ?? 6379;
      const redisPassword = (redis as { password?: string }).password;
      const redisDb = (redis as { db?: number }).db ?? 0;
      const redisTls = (redis as { tls?: boolean }).tls ?? false;

      finalStorageConfig = {
        type: 'redis',
        redis: {
          config: {
            host: redisHost,
            port: redisPort,
            password: redisPassword,
            db: redisDb,
            tls: redisTls,
          },
        },
      };

      logger?.debug('[ElicitationStoreFactory] Converted redis option to storage config', {
        host: redisHost,
        port: redisPort,
      });
    }
  }

  // Check for Vercel KV - not supported for elicitation (no pub/sub)
  if (finalStorageConfig?.type === 'vercel-kv' || process.env['KV_REST_API_URL']) {
    throw new ElicitationNotSupportedError(
      'Vercel KV is not supported for elicitation stores. ' +
        'Elicitation requires pub/sub for cross-node result routing, which Vercel KV does not support. ' +
        'Use Redis or Upstash instead.',
    );
  }

  // Edge runtime requires distributed storage
  if (isEdgeRuntime && (!finalStorageConfig || finalStorageConfig.type === 'memory')) {
    throw new ElicitationNotSupportedError(
      'Elicitation requires distributed storage when running on Edge runtime. ' +
        'Edge functions are stateless and cannot use in-memory elicitation. ' +
        'Configure Redis or Upstash storage.',
    );
  }

  // Create storage using utils factory
  const storage = await createStorage({
    ...finalStorageConfig,
    prefix: keyPrefix,
    fallback: isEdgeRuntime ? 'error' : 'memory',
  });

  // Verify pub/sub support if required
  if (requiresPubSub && !storage.supportsPubSub()) {
    throw new ElicitationNotSupportedError(
      'Elicitation requires pub/sub support for cross-node result routing. ' +
        'The configured storage backend does not support pub/sub. ' +
        'Use Memory (single-node), Redis, or Upstash storage.',
    );
  }

  // Create the store
  const store = new StorageElicitationStore(storage, logger);
  const type = detectStorageType(storage);

  logger?.info('[ElicitationStoreFactory] Created elicitation store', {
    type,
    keyPrefix,
    supportsPubSub: storage.supportsPubSub(),
  });

  return { store, type, storage };
}

/**
 * Create an in-memory elicitation store explicitly.
 * Use this when you know you want in-memory storage regardless of configuration.
 *
 * @param options - Optional configuration
 * @returns An in-memory elicitation store
 */
export function createMemoryElicitationStore(
  options: {
    keyPrefix?: string;
    logger?: FrontMcpLogger;
  } = {},
): ElicitationStoreResult {
  const { keyPrefix = 'mcp:elicit:', logger } = options;

  const storage = createMemoryStorage({ prefix: keyPrefix });
  const store = new StorageElicitationStore(storage, logger);

  logger?.debug('[ElicitationStoreFactory] Created explicit in-memory elicitation store');

  return { store, type: 'memory', storage };
}

/**
 * Create an elicitation store from an existing storage instance.
 * Use this when you want to share a storage connection with other systems.
 *
 * @param storage - Existing storage instance
 * @param options - Optional configuration
 * @returns An elicitation store using the provided storage
 */
export function createElicitationStoreFromStorage(
  storage: RootStorage,
  options: {
    keyPrefix?: string;
    logger?: FrontMcpLogger;
    requiresPubSub?: boolean;
  } = {},
): ElicitationStoreResult {
  const { keyPrefix = 'mcp:elicit:', logger, requiresPubSub = true } = options;

  // Verify pub/sub support if required
  if (requiresPubSub && !storage.supportsPubSub()) {
    throw new ElicitationNotSupportedError(
      'Elicitation requires pub/sub support for cross-node result routing. ' +
        'The provided storage does not support pub/sub.',
    );
  }

  // Create namespaced storage with prefix
  const namespacedStorage = storage.namespace(keyPrefix.replace(/:$/, ''));
  const store = new StorageElicitationStore(namespacedStorage, logger);
  const type = detectStorageType(storage);

  logger?.debug('[ElicitationStoreFactory] Created elicitation store from existing storage', { type, keyPrefix });

  return { store, type, storage };
}
