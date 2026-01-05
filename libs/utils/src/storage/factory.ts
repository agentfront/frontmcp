/**
 * Storage Factory
 *
 * Factory function to create storage adapters with auto-detection.
 */

import type { StorageConfig, StorageType, RootStorage, StorageAdapter } from './types';
import { StorageConfigError, StorageConnectionError } from './errors';
import { createRootStorage, createNamespacedStorage } from './namespace';
import { MemoryStorageAdapter } from './adapters/memory';

/**
 * Check if running in production environment.
 */
function isProduction(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Detect the best available storage type based on environment.
 *
 * Detection order:
 * 1. Upstash (UPSTASH_REDIS_REST_URL)
 * 2. Vercel KV (KV_REST_API_URL)
 * 3. Redis (REDIS_URL or REDIS_HOST)
 * 4. Memory (fallback)
 */
function detectStorageType(): StorageType {
  // Check for Upstash
  if (process.env['UPSTASH_REDIS_REST_URL'] && process.env['UPSTASH_REDIS_REST_TOKEN']) {
    return 'upstash';
  }

  // Check for Vercel KV
  if (process.env['KV_REST_API_URL'] && process.env['KV_REST_API_TOKEN']) {
    return 'vercel-kv';
  }

  // Check for Redis
  if (process.env['REDIS_URL'] || process.env['REDIS_HOST']) {
    return 'redis';
  }

  // Default to memory
  return 'memory';
}

/**
 * Create a storage adapter based on type.
 */
async function createAdapter(type: StorageType, config: StorageConfig): Promise<StorageAdapter> {
  switch (type) {
    case 'memory': {
      return new MemoryStorageAdapter(config.memory);
    }

    case 'redis': {
      // Dynamic import to avoid bundling ioredis
      const { RedisStorageAdapter } = await import('./adapters/redis.js');
      return new RedisStorageAdapter(config.redis);
    }

    case 'vercel-kv': {
      // Dynamic import to avoid bundling @vercel/kv
      const { VercelKvStorageAdapter } = await import('./adapters/vercel-kv.js');
      return new VercelKvStorageAdapter(config.vercelKv);
    }

    case 'upstash': {
      // Dynamic import to avoid bundling @upstash/redis
      const { UpstashStorageAdapter } = await import('./adapters/upstash.js');
      return new UpstashStorageAdapter(config.upstash);
    }

    case 'auto':
      throw new Error('Auto type should be resolved before calling createAdapter');

    default:
      throw new StorageConfigError('unknown', `Unknown storage type: ${type}`);
  }
}

/**
 * Create a storage instance.
 *
 * @param config - Storage configuration
 * @returns Promise<RootStorage> - Namespaced storage instance
 *
 * @example Basic usage with auto-detection
 * ```typescript
 * const store = await createStorage();
 * await store.set('key', 'value');
 * ```
 *
 * @example Explicit type
 * ```typescript
 * const store = await createStorage({ type: 'redis', redis: { url: 'redis://localhost:6379' } });
 * await store.connect();
 * ```
 *
 * @example With namespaces
 * ```typescript
 * const store = await createStorage({ type: 'memory' });
 * const session = store.namespace('session', sessionId);
 * await session.set('user', JSON.stringify(user));
 * // Key: session:{sessionId}:user
 * ```
 *
 * @example With root prefix
 * ```typescript
 * const store = await createStorage({
 *   type: 'redis',
 *   prefix: 'myapp:',
 *   redis: { host: 'localhost' }
 * });
 * // All keys will be prefixed with 'myapp:'
 * ```
 */
export async function createStorage(config: StorageConfig = {}): Promise<RootStorage> {
  let type = config.type ?? 'auto';
  const fallback = config.fallback ?? (isProduction() ? 'error' : 'memory');

  // Resolve 'auto' type
  if (type === 'auto') {
    type = detectStorageType();

    // Warn in production if falling back to memory
    if (type === 'memory' && isProduction()) {
      console.warn(
        '[storage] Warning: No distributed storage backend detected in production. ' +
          'Using in-memory storage. Set REDIS_URL, UPSTASH_REDIS_REST_URL, or KV_REST_API_URL.',
      );
    }
  }

  let adapter: StorageAdapter;

  try {
    adapter = await createAdapter(type, config);
  } catch (e) {
    // Handle fallback
    if (fallback === 'memory' && type !== 'memory') {
      console.warn(
        `[storage] Warning: Failed to create ${type} adapter, falling back to memory. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      adapter = new MemoryStorageAdapter(config.memory);
    } else {
      throw e;
    }
  }

  // Connect the adapter
  try {
    await adapter.connect();
  } catch (e) {
    // Handle connection failure with fallback
    if (fallback === 'memory' && type !== 'memory') {
      console.warn(
        `[storage] Warning: Failed to connect to ${type}, falling back to memory. ` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      );
      adapter = new MemoryStorageAdapter(config.memory);
      await adapter.connect();
    } else {
      throw e;
    }
  }

  // Wrap with namespace if prefix is provided
  if (config.prefix) {
    return createNamespacedStorage(adapter, config.prefix);
  }

  return createRootStorage(adapter);
}

/**
 * Create a storage instance synchronously (memory only).
 *
 * Use this when you need synchronous creation and are okay with memory storage.
 * For distributed storage, use the async `createStorage` function instead.
 *
 * @param config - Memory adapter options
 * @returns RootStorage - Namespaced storage instance
 *
 * @example
 * ```typescript
 * const store = createMemoryStorage({ maxEntries: 1000 });
 * store.connect().then(() => {
 *   store.set('key', 'value');
 * });
 * ```
 */
export function createMemoryStorage(
  config: import('./types').MemoryAdapterOptions & { prefix?: string } = {},
): RootStorage {
  const adapter = new MemoryStorageAdapter(config);

  if (config.prefix) {
    return createNamespacedStorage(adapter, config.prefix);
  }

  return createRootStorage(adapter);
}

/**
 * Get the detected storage type without creating an adapter.
 * Useful for logging or conditional logic.
 *
 * @returns The detected storage type
 */
export function getDetectedStorageType(): StorageType {
  return detectStorageType();
}
