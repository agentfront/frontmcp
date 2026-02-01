/**
 * EventStore Factory
 *
 * Factory functions for creating EventStore instances based on configuration.
 * Supports Memory and Redis backends with automatic provider detection.
 *
 * @module transport/event-stores/event-store.factory
 */

import type { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FrontMcpLogger, RedisOptionsInput } from '../../common';

/**
 * EventStore configuration for SSE resumability support.
 */
export interface EventStoreConfig {
  /**
   * Whether EventStore is enabled.
   * When true, clients can reconnect and resume missed SSE messages using Last-Event-ID header.
   * @default false
   */
  enabled: boolean;

  /**
   * Storage provider type.
   * - 'memory': In-memory storage (single-node only)
   * - 'redis': Redis-backed storage (distributed)
   * @default 'memory'
   */
  provider?: 'memory' | 'redis';

  /**
   * Maximum number of events to store before eviction.
   * @default 10000
   */
  maxEvents?: number;

  /**
   * TTL in milliseconds for stored events.
   * @default 300000 (5 minutes)
   */
  ttlMs?: number;

  /**
   * Redis configuration (required if provider is 'redis').
   */
  redis?: RedisOptionsInput;
}

/**
 * Result of creating an EventStore.
 */
export interface EventStoreResult {
  /**
   * The created EventStore instance, or undefined if disabled.
   */
  eventStore: EventStore | undefined;

  /**
   * The type of storage backend used.
   */
  type: 'memory' | 'redis' | 'disabled';
}

/**
 * Create an EventStore based on configuration.
 *
 * If EventStore is disabled (config.enabled is false or undefined),
 * returns undefined. This disables SSE resumability support.
 *
 * @param config - EventStore configuration
 * @param logger - Optional logger for store operations
 * @returns EventStore instance and type, or undefined if disabled
 *
 * @example Disabled (default)
 * ```typescript
 * const { eventStore, type } = createEventStore(undefined);
 * // eventStore === undefined, type === 'disabled'
 * ```
 *
 * @example Memory (single-node)
 * ```typescript
 * const { eventStore, type } = createEventStore({
 *   enabled: true,
 *   provider: 'memory',
 *   maxEvents: 10000,
 *   ttlMs: 300000,
 * });
 * // type === 'memory'
 * ```
 *
 * @example Redis (distributed)
 * ```typescript
 * const { eventStore, type } = createEventStore({
 *   enabled: true,
 *   provider: 'redis',
 *   redis: { host: 'localhost', port: 6379 },
 *   maxEvents: 10000,
 *   ttlMs: 300000,
 * });
 * // type === 'redis'
 * ```
 */
export function createEventStore(config: EventStoreConfig | undefined, logger?: FrontMcpLogger): EventStoreResult {
  // If not configured or not enabled, return undefined (disables resumability)
  if (!config?.enabled) {
    logger?.verbose('[EventStoreFactory] EventStore disabled (resumability not available)');
    return { eventStore: undefined, type: 'disabled' };
  }

  const provider = config.provider ?? 'memory';
  const maxEvents = config.maxEvents ?? 10000;
  const ttlMs = config.ttlMs ?? 300000;

  if (provider === 'redis') {
    if (!config.redis) {
      throw new Error(
        'EventStore Redis configuration required when provider is "redis". ' +
          'Provide redis config: { provider: "redis", host: "...", port: ... }',
      );
    }

    // Lazy-load Redis EventStore
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RedisEventStore } = require('./redis.event-store');

    logger?.info('[EventStoreFactory] Creating Redis EventStore for resumability', {
      maxEvents,
      ttlMs,
    });

    return {
      eventStore: new RedisEventStore({
        redis: config.redis,
        maxEvents,
        ttlMs,
      }),
      type: 'redis',
    };
  }

  // Default: memory
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MemoryEventStore } = require('./memory.event-store');

  logger?.info('[EventStoreFactory] Creating in-memory EventStore for resumability', {
    maxEvents,
    ttlMs,
  });

  return {
    eventStore: new MemoryEventStore({
      maxEvents,
      ttlMs,
    }),
    type: 'memory',
  };
}
