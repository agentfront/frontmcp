import type { EventId, EventStore, StreamId } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

interface StoredEvent {
  id: EventId;
  msg: JSONRPCMessage;
  timestamp: number;
}

export interface MemoryEventStoreOptions {
  /** Maximum number of events to store before eviction. Default: 10000 */
  maxEvents?: number;
  /** TTL in milliseconds for stored events. Default: 300000 (5 minutes) */
  ttlMs?: number;
}

/**
 * Bounded in-memory EventStore for SSE resumability support.
 *
 * Features:
 * - TTL-based expiration of old events
 * - Max events limit with LRU eviction
 * - Per-stream storage with global index
 *
 * Use this for single-node deployments or development.
 * For distributed deployments, use RedisEventStore instead.
 */
export class MemoryEventStore implements EventStore {
  private streams = new Map<StreamId, StoredEvent[]>();
  private index = new Map<EventId, { streamId: StreamId; idx: number }>();
  private readonly maxEvents: number;
  private readonly ttlMs: number;

  constructor(options: MemoryEventStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? 10000;
    this.ttlMs = options.ttlMs ?? 300000; // 5 minutes default
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    this.evictExpired();

    const list = this.streams.get(streamId) ?? [];
    const id = `${streamId}:${list.length + 1}` as EventId;
    const rec: StoredEvent = { id, msg: message, timestamp: Date.now() };

    list.push(rec);
    this.streams.set(streamId, list);
    this.index.set(id, { streamId, idx: list.length - 1 });

    // Evict oldest if over max
    if (this.index.size > this.maxEvents) {
      this.evictOldest();
    }

    return id;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    const meta = this.index.get(lastEventId);
    if (!meta) {
      // Unknown lastEventId: return a default/new stream with nothing to replay
      const freshStream = 'default-stream' as StreamId;
      if (!this.streams.has(freshStream)) this.streams.set(freshStream, []);
      return freshStream;
    }

    const { streamId, idx } = meta;
    const list = this.streams.get(streamId) ?? [];

    for (let k = idx + 1; k < list.length; k++) {
      const e = list[k];
      // Only replay non-expired events
      if (Date.now() - e.timestamp < this.ttlMs) {
        await send(e.id, e.msg);
      }
    }

    return streamId;
  }

  /**
   * Evict all expired events across all streams
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [streamId, list] of this.streams) {
      const validEvents = list.filter((e) => now - e.timestamp < this.ttlMs);
      if (validEvents.length < list.length) {
        this.streams.set(streamId, validEvents);
        // Rebuild index for this stream
        this.rebuildIndex(streamId, validEvents);
      }
    }
  }

  /**
   * Evict the oldest event across all streams
   */
  private evictOldest(): void {
    // Find and remove oldest event across all streams
    let oldest: { streamId: StreamId; idx: number; timestamp: number } | null = null;

    for (const [streamId, list] of this.streams) {
      if (list.length > 0 && (!oldest || list[0].timestamp < oldest.timestamp)) {
        oldest = { streamId, idx: 0, timestamp: list[0].timestamp };
      }
    }

    if (oldest) {
      const list = this.streams.get(oldest.streamId);
      if (list && list.length > 0) {
        const removed = list.shift();
        if (removed) {
          this.index.delete(removed.id);
        }
        this.rebuildIndex(oldest.streamId, list);
      }
    }
  }

  /**
   * Rebuild the index for a specific stream after modification
   */
  private rebuildIndex(streamId: StreamId, list: StoredEvent[]): void {
    // Clear old entries for this stream
    for (const [id, meta] of this.index) {
      if (meta.streamId === streamId) {
        this.index.delete(id);
      }
    }
    // Rebuild
    list.forEach((e, idx) => this.index.set(e.id, { streamId, idx }));
  }

  /**
   * Clear all stored events (useful for testing)
   */
  clear(): void {
    this.streams.clear();
    this.index.clear();
  }

  /**
   * Get the current number of stored events
   */
  get size(): number {
    return this.index.size;
  }
}
