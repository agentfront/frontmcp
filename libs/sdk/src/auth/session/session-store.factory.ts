/**
 * Session Store Factory
 *
 * Factory functions for creating session stores based on configuration.
 * Supports Redis, Vercel KV, and SQLite providers.
 * Uses @frontmcp/utils storage adapters internally.
 */

import { RedisStorageAdapter, type StorageAdapter } from '@frontmcp/utils';
import type { SessionStore } from './transport-session.types';
import {
  type FrontMcpLogger,
  type RedisOptions,
  type RedisProviderOptions,
  type VercelKvProviderOptions,
  type PubsubOptions,
  type SqliteOptionsInput,
  isRedisProvider,
  isVercelKvProvider,
} from '../../common';

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
  const { RedisSessionStore } = require('./redis-session.store');

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
  const { VercelKvSessionStore } = require('./vercel-kv-session.store');

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
  const { RedisSessionStore } = require('./redis-session.store');
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
 * @returns A Redis storage adapter with pub/sub support
 *
 * @example Hybrid config
 * ```typescript
 * // Use Vercel KV for sessions, Redis for pub/sub
 * const sessionStore = await createSessionStore({ provider: 'vercel-kv' });
 * const pubsubStore = createPubsubStore({ host: 'localhost', port: 6379 });
 * ```
 */
/**
 * Create a SQLite session store for local-only deployments.
 *
 * @param options - SQLite storage configuration
 * @param logger - Optional logger instance
 * @returns A SQLite-backed session store
 *
 * @example
 * ```typescript
 * const store = createSqliteSessionStore({
 *   path: '~/.frontmcp/data/sessions.sqlite',
 *   encryption: { secret: 'my-secret' },
 * });
 * ```
 */
export function createSqliteSessionStore(options: SqliteOptionsInput, logger?: FrontMcpLogger): SessionStore {
  // Lazy require to avoid bundling @frontmcp/storage-sqlite when not used
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SqliteSessionStore } = require('@frontmcp/storage-sqlite');

  logger?.info('[SessionStoreFactory] Creating SQLite session store', { path: options.path });

  return new SqliteSessionStore(options);
}

export function createPubsubStore(options: PubsubOptions): StorageAdapter {
  const redisOptions = options as RedisProviderOptions;
  return new RedisStorageAdapter({
    config: {
      host: redisOptions.host,
      port: redisOptions.port,
      password: redisOptions.password,
      db: redisOptions.db,
      tls: redisOptions.tls,
    },
    keyPrefix: redisOptions.keyPrefix,
  });
}
