/**
 * Elicitation Store Factory
 *
 * Factory functions for creating elicitation stores based on configuration.
 * Supports Redis provider for distributed deployments and in-memory for single-node.
 *
 * Note: Vercel KV is NOT supported for elicitation because it doesn't support pub/sub
 * operations which are required for cross-node result routing.
 *
 * @module elicitation/elicitation-store.factory
 */

import type { ElicitationStore } from './elicitation.store';
import { type FrontMcpLogger, type RedisOptionsInput, type RedisProviderOptions } from '../common';

/**
 * Options for creating an elicitation store.
 */
export interface ElicitationStoreOptions {
  /**
   * Redis configuration for distributed deployments.
   * If not provided, falls back to in-memory store.
   * Accepts the input type (before Zod validation).
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
   * Whether running in Edge runtime (requires Redis).
   * @default false
   */
  isEdgeRuntime?: boolean;
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
   * The type of store created.
   */
  type: 'redis' | 'memory';
}

/**
 * Create an elicitation store based on configuration.
 *
 * @param options - Store configuration
 * @returns The created elicitation store with type information
 *
 * @example Redis (distributed mode)
 * ```typescript
 * const { store, type } = createElicitationStore({
 *   redis: {
 *     provider: 'redis',
 *     host: 'localhost',
 *     port: 6379,
 *   },
 *   logger,
 * });
 * // type === 'redis'
 * ```
 *
 * @example Memory (single-node mode)
 * ```typescript
 * const { store, type } = createElicitationStore({
 *   logger,
 * });
 * // type === 'memory'
 * ```
 *
 * @throws {Error} If Vercel KV is configured (pub/sub not supported)
 * @throws {Error} If running on Edge runtime without Redis configuration
 */
export function createElicitationStore(options: ElicitationStoreOptions = {}): ElicitationStoreResult {
  const { redis, keyPrefix = 'mcp:elicit:', logger, isEdgeRuntime = false } = options;

  // Check for Vercel KV - not supported for elicitation (no pub/sub)
  // Type assertion needed as RedisOptionsInput may not have provider
  if (redis && 'provider' in redis && redis.provider === 'vercel-kv') {
    throw new Error(
      'Vercel KV is not supported for elicitation stores. ' +
        'Elicitation requires pub/sub for cross-node result routing, which Vercel KV does not support. ' +
        'Use Redis provider instead: { provider: "redis", host: "...", port: ... }',
    );
  }

  // Check if Redis is configured - supports both new format (with provider) and legacy format (without provider)
  // Legacy format: { host: '...', port: ... } - treated as Redis
  // New format: { provider: 'redis', host: '...', port: ... }
  const isNewRedisFormat = redis && 'provider' in redis && redis.provider === 'redis' && 'host' in redis;
  const isLegacyRedisFormat = redis && !('provider' in redis) && 'host' in redis && typeof redis.host === 'string';
  const hasRedisConfig = isNewRedisFormat || isLegacyRedisFormat;

  if (hasRedisConfig && redis) {
    // Convert legacy format to RedisProviderOptions shape for the store
    // Apply defaults for optional fields to match the output schema type
    const redisConfig: RedisProviderOptions = isLegacyRedisFormat
      ? {
          provider: 'redis' as const,
          host: (redis as { host: string }).host,
          port: (redis as { port?: number }).port ?? 6379,
          password: (redis as { password?: string }).password,
          db: (redis as { db?: number }).db ?? 0,
          tls: (redis as { tls?: boolean }).tls ?? false,
          keyPrefix: (redis as { keyPrefix?: string }).keyPrefix ?? 'mcp:',
          defaultTtlMs: (redis as { defaultTtlMs?: number }).defaultTtlMs ?? 3600000,
        }
      : (redis as RedisProviderOptions);
    return createRedisElicitationStore(redisConfig, keyPrefix, logger);
  }

  // Edge runtime requires Redis - cannot use in-memory store
  if (isEdgeRuntime) {
    const { ElicitationNotSupportedError } = require('../errors/elicitation.error');
    throw new ElicitationNotSupportedError(
      'Elicitation requires Redis configuration when running on Edge runtime. ' +
        'Edge functions are stateless and cannot use in-memory elicitation. ' +
        'Configure redis in @FrontMcp({ redis: { provider: "redis", host: "...", port: ... } })',
    );
  }

  // Fall back to in-memory store for single-node/dev
  return createMemoryElicitationStore(logger);
}

/**
 * Create a Redis-backed elicitation store.
 * @internal
 */
function createRedisElicitationStore(
  options: RedisProviderOptions,
  keyPrefix: string,
  logger?: FrontMcpLogger,
): ElicitationStoreResult {
  // Lazy require to avoid bundling ioredis when not used
  const { RedisElicitationStore } = require('./redis-elicitation.store');
  const Redis = require('ioredis').default;

  // Create Redis client with configuration
  const redisClient = new Redis({
    host: options.host,
    port: options.port ?? 6379,
    password: options.password,
    db: options.db ?? 0,
    ...(options.tls && { tls: {} }),
    // Add key prefix to Redis options for consistent prefixing
    keyPrefix: keyPrefix,
  });

  const store = new RedisElicitationStore(redisClient, logger);

  logger?.info('[ElicitationStoreFactory] Created Redis elicitation store (distributed mode)', {
    host: options.host,
    port: options.port ?? 6379,
    keyPrefix,
  });

  return { store, type: 'redis' };
}

/**
 * Create an in-memory elicitation store.
 * @internal
 */
function createMemoryElicitationStore(logger?: FrontMcpLogger): ElicitationStoreResult {
  // Lazy require to avoid circular imports
  const { InMemoryElicitationStore } = require('./memory-elicitation.store');

  const store = new InMemoryElicitationStore();

  logger?.warn(
    '[ElicitationStoreFactory] Created in-memory elicitation store (single-node mode). ' +
      'Configure Redis for distributed deployments.',
  );

  return { store, type: 'memory' };
}

/**
 * Create an in-memory elicitation store explicitly.
 * Use this when you know you want in-memory storage regardless of configuration.
 *
 * @param logger - Optional logger instance
 * @returns An in-memory elicitation store
 */
export function createMemoryElicitationStoreExplicit(logger?: FrontMcpLogger): ElicitationStore {
  const { InMemoryElicitationStore } = require('./memory-elicitation.store');
  logger?.verbose('[ElicitationStoreFactory] Created explicit in-memory elicitation store');
  return new InMemoryElicitationStore();
}
