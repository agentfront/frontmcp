/**
 * EventStore Module
 *
 * Provides EventStore implementations for SSE resumability support.
 * When enabled, clients can reconnect and resume missed SSE messages
 * using the Last-Event-ID header per the MCP protocol.
 *
 * @module transport/event-stores
 *
 * @example Disabled (default - no resumability)
 * ```typescript
 * // In @FrontMcp config, eventStore is undefined by default
 * // This disables SSE resumability
 * ```
 *
 * @example Memory EventStore (single-node)
 * ```typescript
 * import { createEventStore } from '@frontmcp/sdk/transport/event-stores';
 *
 * const { eventStore, type } = createEventStore({
 *   enabled: true,
 *   provider: 'memory',
 *   maxEvents: 10000,
 *   ttlMs: 300000,
 * });
 * ```
 *
 * @example Redis EventStore (distributed)
 * ```typescript
 * import { createEventStore } from '@frontmcp/sdk/transport/event-stores';
 *
 * const { eventStore, type } = createEventStore({
 *   enabled: true,
 *   provider: 'redis',
 *   redis: { host: 'localhost', port: 6379 },
 *   maxEvents: 10000,
 *   ttlMs: 300000,
 * });
 * ```
 */

// Factory
export { createEventStore } from './event-store.factory';
export type { EventStoreConfig, EventStoreResult } from './event-store.factory';

// Memory implementation
export { MemoryEventStore } from './memory.event-store';
export type { MemoryEventStoreOptions } from './memory.event-store';

// Redis implementation
export { RedisEventStore } from './redis.event-store';
export type { RedisEventStoreOptions } from './redis.event-store';
