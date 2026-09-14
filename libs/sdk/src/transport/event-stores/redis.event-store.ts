import { type EventId, type EventStore, type JSONRPCMessage, type StreamId } from '@frontmcp/protocol';

import { type RedisOptionsInput } from '../../common';
import { VercelKvNotSupportedError } from '../../errors/sdk.errors';

export interface RedisEventStoreOptions {
  /**
   * Redis configuration.
   * Supports both Redis (ioredis) and Vercel KV providers.
   */
  redis: RedisOptionsInput;

  /**
   * Key prefix for all event keys.
   * @default 'mcp:events:'
   */
  keyPrefix?: string;

  /**
   * Maximum number of events per stream.
   * @default 10000
   */
  maxEvents?: number;

  /**
   * TTL in milliseconds for stored events.
   * @default 300000 (5 minutes)
   */
  ttlMs?: number;
}

/**
 * Redis-based EventStore for SSE resumability support.
 *
 * Uses Redis Streams (XADD) for efficient event storage and retrieval.
 * Suitable for distributed deployments where multiple server instances
 * need to share event state for SSE resumability.
 *
 * Features:
 * - Uses Redis Streams for efficient event storage
 * - TTL-based expiration via key TTL
 * - Max events limit via MAXLEN trimming
 * - Automatic Redis client lazy initialization
 *
 * @example
 * ```typescript
 * const eventStore = new RedisEventStore({
 *   redis: { provider: 'redis', host: 'localhost', port: 6379 },
 *   maxEvents: 10000,
 *   ttlMs: 300000,
 * });
 * ```
 */
export class RedisEventStore implements EventStore {
  private client: unknown; // Redis client (lazy loaded)
  private readonly keyPrefix: string;
  private readonly maxEvents: number;
  private readonly ttlSeconds: number;
  private readonly redisOptions: RedisOptionsInput;

  constructor(options: RedisEventStoreOptions) {
    this.redisOptions = options.redis;
    this.keyPrefix = options.keyPrefix ?? 'mcp:events:';
    this.maxEvents = options.maxEvents ?? 10000;
    this.ttlSeconds = Math.ceil((options.ttlMs ?? 300000) / 1000);
  }

  /**
   * Get or create the Redis client.
   * Uses lazy initialization to avoid connection issues at startup.
   */
  private async getClient(): Promise<{
    xadd: (...args: unknown[]) => Promise<string>;
    xrange: (...args: unknown[]) => Promise<[string, string[]][]>;
    expire: (key: string, seconds: number) => Promise<number>;
  }> {
    if (!this.client) {
      const redis = this.redisOptions;

      // Check provider type - cast to unknown first to allow comparison with any string
      const provider = 'provider' in redis ? (redis.provider as unknown as string) : undefined;
      if (provider === 'vercel-kv' || provider === '@vercel/kv') {
        // Vercel KV doesn't support Redis Streams (XADD/XRANGE)
        // Fall back to a simple key-value based approach
        throw new VercelKvNotSupportedError(
          'Redis Streams (required for EventStore). Use standard Redis provider instead',
        );
      }

      // Use ioredis for 'redis' provider

      const Redis = require('ioredis');

      // Extract connection config
      const host = 'host' in redis && typeof redis.host === 'string' ? redis.host : 'localhost';
      const port = 'port' in redis && typeof redis.port === 'number' ? redis.port : 6379;
      const password = 'password' in redis && typeof redis.password === 'string' ? redis.password : undefined;
      const db = 'db' in redis && typeof redis.db === 'number' ? redis.db : 0;
      const tls = 'tls' in redis && redis.tls === true ? {} : undefined;

      this.client = new Redis({
        host,
        port,
        password,
        db,
        tls,
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
      });

      await (this.client as { connect: () => Promise<void> }).connect();
    }

    return this.client as {
      xadd: (...args: unknown[]) => Promise<string>;
      xrange: (...args: unknown[]) => Promise<[string, string[]][]>;
      expire: (key: string, seconds: number) => Promise<number>;
    };
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const client = await this.getClient();
    const streamKey = `${this.keyPrefix}${streamId}`;

    // Use Redis Stream (XADD) for event storage with MAXLEN trimming
    const redisId = await client.xadd(
      streamKey,
      'MAXLEN',
      '~',
      this.maxEvents.toString(),
      '*',
      'msg',
      JSON.stringify(message),
    );

    // Set TTL on the stream
    await client.expire(streamKey, this.ttlSeconds);

    return `${streamId}:${redisId}` as EventId;
  }

  /**
   * Resolve the stream an event belongs to.
   *
   * Optional in the upstream `EventStore` contract, and the transport's
   * 409-conflict guard (refusing a second live stream for the same id) is dead
   * code while no store provides it (GHSA-84j6-jc92-77jm).
   */
  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    const parsed = this.parseEventId(eventId);
    return parsed ? parsed[0] : undefined;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    { send }: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    // Parse BEFORE connecting: the stream id half is concatenated into a Redis
    // key, so a malformed or unsafe id must not reach one — and a garbage
    // `Last-Event-ID` should not cost a connection either.
    const parsed = this.parseEventId(lastEventId);
    if (!parsed) {
      return 'default-stream' as StreamId;
    }

    const client = await this.getClient();
    const [streamId, redisId] = parsed;
    const streamKey = `${this.keyPrefix}${streamId}`;

    // Read events after the last ID using exclusive range
    const entries = await client.xrange(streamKey, `(${redisId}`, '+');

    for (const [id, fields] of entries) {
      // fields is an array: ['msg', '{"jsonrpc":"2.0",...}']
      const msgIndex = fields.indexOf('msg');
      if (msgIndex !== -1 && msgIndex + 1 < fields.length) {
        const msgStr = fields[msgIndex + 1];
        const msg = JSON.parse(msgStr) as JSONRPCMessage;
        await send(`${streamId}:${id}` as EventId, msg);
      }
    }

    return streamId;
  }

  /**
   * Parse an event ID into stream ID and Redis stream entry ID.
   *
   * Event IDs have format: `{streamId}:{redisStreamEntryId}`
   * Redis stream entry IDs have format: `{timestamp}-{sequence}`
   *
   * The entry-id half is validated because it is interpolated into the `xrange`
   * range argument (`(${redisId}`), where a malformed value is a protocol error
   * rather than data.
   *
   * The stream-id half is NOT character-filtered. `xadd`/`xrange` take the key
   * as an exact argument — Redis applies no glob matching there — and ioredis
   * length-prefixes it, so no character is special. Filtering here would also
   * make `storeEvent`, which accepts any `StreamId`, able to mint ids this
   * function then refuses, silently breaking replay for that stream. Ownership
   * is enforced by the session-scoped facade (GHSA-84j6-jc92-77jm), not by
   * guessing at the id's characters.
   *
   * @returns the pair, or `undefined` when the id is malformed.
   *
   * @example
   * 'my-stream:1234567890123-0' -> ['my-stream', '1234567890123-0']
   */
  private parseEventId(eventId: EventId): [StreamId, string] | undefined {
    const value = String(eventId);
    // Redis stream IDs contain a '-', so find the last colon that separates the
    // stream ID from the Redis entry ID.
    const lastDash = value.lastIndexOf('-');
    const separator = lastDash === -1 ? value.lastIndexOf(':') : value.lastIndexOf(':', lastDash);
    if (separator <= 0 || separator === value.length - 1) return undefined;

    const streamId = value.slice(0, separator);
    const redisId = value.slice(separator + 1);

    // `{millis}-{seq}`, or a bare `{millis}` (what XADD accepts as a range start).
    if (!/^\d+(-\d+)?$/.test(redisId)) return undefined;

    return [streamId as StreamId, redisId];
  }

  /**
   * Close the Redis client connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await (this.client as { quit: () => Promise<void> }).quit();
      this.client = undefined;
    }
  }
}
