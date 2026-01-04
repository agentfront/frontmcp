/**
 * Storage Factory
 *
 * Factory functions for creating store drivers and session stores
 * based on configuration. Supports both Redis and Vercel KV providers.
 */

import type { StoreDriver } from './store.types';
import type { SessionStore } from '../auth/session/transport-session.types';
import type { FrontMcpLogger } from '../common/interfaces/logger.interface';
import {
  type RedisOptions,
  type RedisProviderOptions,
  type VercelKvProviderOptions,
  type PubsubOptions,
  isRedisProvider,
  isVercelKvProvider,
} from '../common/types/options/redis.options';

/**
 * Create a store driver based on configuration
 *
 * @param options - Storage configuration (Redis or Vercel KV)
 * @returns A store driver instance (not connected)
 *
 * @example Redis
 * ```typescript
 * const driver = createStoreDriver({
 *   provider: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 * });
 * await driver.connect();
 * ```
 *
 * @example Vercel KV
 * ```typescript
 * const driver = createStoreDriver({
 *   provider: 'vercel-kv',
 *   // Uses KV_REST_API_URL and KV_REST_API_TOKEN env vars
 * });
 * await driver.connect();
 * ```
 */
export function createStoreDriver(options: RedisOptions): StoreDriver {
  if (isVercelKvProvider(options)) {
    return createVercelKvStoreDriver(options);
  }

  if (isRedisProvider(options)) {
    return createRedisStoreDriver(options);
  }

  // Fallback for legacy format without provider field
  return createRedisStoreDriver(options as RedisProviderOptions);
}

/**
 * Create a Redis store driver
 */
function createRedisStoreDriver(options: RedisProviderOptions): StoreDriver {
  // Lazy import to avoid bundling ioredis when not used

  const { ScopedRedisStore } = require('./adapters/store.redis.adapter');

  return new ScopedRedisStore({
    options: {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls ? {} : undefined,
      keyPrefix: options.keyPrefix,
    },
  });
}

/**
 * Create a Vercel KV store driver
 */
function createVercelKvStoreDriver(options: VercelKvProviderOptions): StoreDriver {
  // Lazy import to avoid bundling @vercel/kv when not used

  const { ScopedVercelKvStore } = require('./adapters/store.vercel-kv.adapter');

  return new ScopedVercelKvStore({
    url: options.url,
    token: options.token,
    keyPrefix: options.keyPrefix,
  });
}

/**
 * Create a session store based on configuration
 *
 * @param options - Storage configuration (Redis or Vercel KV)
 * @param logger - Optional logger instance
 * @returns A session store instance
 *
 * @example Redis
 * ```typescript
 * const store = await createSessionStore({
 *   provider: 'redis',
 *   host: 'localhost',
 *   port: 6379,
 * });
 * ```
 *
 * @example Vercel KV
 * ```typescript
 * const store = await createSessionStore({
 *   provider: 'vercel-kv',
 * });
 * ```
 */
export async function createSessionStore(options: RedisOptions, logger?: FrontMcpLogger): Promise<SessionStore> {
  if (isVercelKvProvider(options)) {
    return createVercelKvSessionStore(options, logger);
  }

  if (isRedisProvider(options)) {
    return createRedisSessionStore(options, logger);
  }

  // Fallback for legacy format without provider field
  return createRedisSessionStore(options as RedisProviderOptions, logger);
}

/**
 * Create a Redis session store
 */
async function createRedisSessionStore(options: RedisProviderOptions, logger?: FrontMcpLogger): Promise<SessionStore> {
  // Lazy require to avoid bundling ioredis when not used

  const { RedisSessionStore } = require('../auth/session/redis-session.store');

  return new RedisSessionStore(
    {
      host: options.host,
      port: options.port,
      password: options.password,
      db: options.db,
      tls: options.tls,
      keyPrefix: options.keyPrefix ? `${options.keyPrefix}session:` : 'mcp:session:',
      defaultTtlMs: options.defaultTtlMs,
    },
    logger,
  );
}

/**
 * Create a Vercel KV session store
 */
async function createVercelKvSessionStore(
  options: VercelKvProviderOptions,
  logger?: FrontMcpLogger,
): Promise<SessionStore> {
  // Lazy require to avoid bundling @vercel/kv when not used

  const { VercelKvSessionStore } = require('../auth/session/vercel-kv-session.store');

  const store = new VercelKvSessionStore(
    {
      url: options.url,
      token: options.token,
      keyPrefix: options.keyPrefix ? `${options.keyPrefix}session:` : 'mcp:session:',
      defaultTtlMs: options.defaultTtlMs,
    },
    logger,
  );

  // Pre-connect for Vercel KV
  await store.connect();

  return store;
}

/**
 * Create a session store synchronously (for backwards compatibility)
 * Note: For Vercel KV, use createSessionStore() instead as it requires async connect
 *
 * @param options - Storage configuration (Redis only)
 * @param logger - Optional logger instance
 * @returns A session store instance
 */
export function createSessionStoreSync(options: RedisOptions, logger?: FrontMcpLogger): SessionStore {
  if (isVercelKvProvider(options)) {
    throw new Error('Vercel KV session store requires async initialization. Use createSessionStore() instead.');
  }

  // Redis only - synchronous creation

  const { RedisSessionStore } = require('../auth/session/redis-session.store');
  const redisOptions = isRedisProvider(options) ? options : (options as RedisProviderOptions);

  return new RedisSessionStore(
    {
      host: redisOptions.host,
      port: redisOptions.port,
      password: redisOptions.password,
      db: redisOptions.db,
      tls: redisOptions.tls,
      keyPrefix: redisOptions.keyPrefix ? `${redisOptions.keyPrefix}session:` : 'mcp:session:',
      defaultTtlMs: redisOptions.defaultTtlMs,
    },
    logger,
  );
}

/**
 * Create a pub/sub store for resource subscriptions
 *
 * Pub/Sub requires Redis - Vercel KV does not support pub/sub operations.
 * Use this when you need resource subscriptions with Vercel KV for sessions.
 *
 * @param options - Pub/sub configuration (Redis only)
 * @returns A Redis store driver with pub/sub support
 *
 * @example Hybrid config
 * ```typescript
 * // Use Vercel KV for sessions, Redis for pub/sub
 * const sessionStore = await createSessionStore({ provider: 'vercel-kv' });
 * const pubsubStore = createPubsubStore({ host: 'localhost', port: 6379 });
 * ```
 */
export function createPubsubStore(options: PubsubOptions): StoreDriver {
  // PubsubOptions only allows Redis provider, so we can safely cast
  const redisOptions = options as RedisProviderOptions;
  return createRedisStoreDriver(redisOptions);
}
