/**
 * Redis Transport Bus — Distributed Session Location Registry
 *
 * Maps sessions to the pods that own them using Redis Hash keys.
 * Used by TransportService in distributed mode to discover which
 * pod owns a given session and (optionally) relay operations to it.
 */

import { MethodNotImplementedError } from '../../errors/transport.errors';
import type { RemoteLocation, TransportBus, TransportKey } from '../transport.types';

/**
 * Minimal Redis client interface for the transport bus.
 * Subset of ioredis — allows plugging any compatible client.
 */
export interface BusRedisClient {
  hset(key: string, field: string, value: string): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
}

/** Default key prefix for bus keys. */
const DEFAULT_BUS_PREFIX = 'mcp:bus:';

/** Default TTL for bus entries (seconds). Matches session default of 1 hour. */
const DEFAULT_BUS_TTL_SECONDS = 3600;

/**
 * Configuration options for RedisTransportBus.
 */
export interface RedisTransportBusOptions {
  /** Redis key prefix. @default 'mcp:bus:' */
  keyPrefix?: string;
  /** TTL for bus entries in seconds. @default 3600 */
  ttlSeconds?: number;
  /** HA relay key prefix for destroy commands. @default 'mcp:ha:' */
  haKeyPrefix?: string;
  /** Logger (optional) */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Redis-backed TransportBus implementation.
 *
 * For each session, stores a Hash with nodeId and channel fields.
 * The bus provides session-to-node mapping for distributed lookups
 * and destroy-remote via pub/sub relay.
 *
 * Note: `proxyRequest()` is deferred — session recreation via
 * TransportService.recreateTransporter() handles cross-pod requests.
 */
export class RedisTransportBus implements TransportBus {
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly haKeyPrefix: string;
  private readonly logger?: RedisTransportBusOptions['logger'];

  constructor(
    private readonly redis: BusRedisClient,
    private readonly machineId: string,
    options?: RedisTransportBusOptions,
  ) {
    this.keyPrefix = options?.keyPrefix ?? DEFAULT_BUS_PREFIX;
    this.ttlSeconds = options?.ttlSeconds ?? DEFAULT_BUS_TTL_SECONDS;
    this.haKeyPrefix = options?.haKeyPrefix ?? 'mcp:ha:';
    this.logger = options?.logger;
  }

  nodeId(): string {
    return this.machineId;
  }

  /**
   * Advertise that this node owns a session.
   * Stores the nodeId and relay channel in a Redis Hash.
   */
  async advertise(key: TransportKey): Promise<void> {
    const redisKey = this.busKey(key);
    const channel = `${this.haKeyPrefix}notify:${this.machineId}`;

    await this.redis.hset(redisKey, 'nodeId', this.machineId);
    await this.redis.hset(redisKey, 'channel', channel);
    await this.redis.expire(redisKey, this.ttlSeconds);

    this.logger?.debug('[TransportBus] Advertised session', {
      sessionId: key.sessionId.slice(0, 20),
      nodeId: this.machineId,
    });
  }

  /**
   * Revoke ownership of a session (e.g., on transport dispose).
   */
  async revoke(key: TransportKey): Promise<void> {
    const redisKey = this.busKey(key);
    await this.redis.del(redisKey);

    this.logger?.debug('[TransportBus] Revoked session', {
      sessionId: key.sessionId.slice(0, 20),
    });
  }

  /**
   * Look up which node owns a session.
   * Returns null if the session is not registered in the bus.
   */
  async lookup(key: TransportKey): Promise<RemoteLocation | null> {
    const redisKey = this.busKey(key);

    const nodeId = await this.redis.hget(redisKey, 'nodeId');
    if (!nodeId) return null;

    // Skip if we own this session — caller should use local transport
    if (nodeId === this.machineId) return null;

    const channel = await this.redis.hget(redisKey, 'channel');
    if (!channel) return null;

    return { nodeId, channel };
  }

  /**
   * Proxy a request to the owning node.
   *
   * Phase 1: Not implemented — TransportService.recreateTransporter()
   * handles cross-pod session access via Redis session store.
   */
  async proxyRequest(): Promise<void> {
    throw new MethodNotImplementedError('RedisTransportBus', 'proxyRequest');
  }

  /**
   * Destroy a session on a remote node via pub/sub relay.
   */
  async destroyRemote(key: TransportKey, reason?: string): Promise<void> {
    const redisKey = this.busKey(key);
    const nodeId = await this.redis.hget(redisKey, 'nodeId');

    if (!nodeId || nodeId === this.machineId) return;

    const channel = await this.redis.hget(redisKey, 'channel');
    if (!channel) return;

    const message = JSON.stringify({
      kind: 'destroy-session',
      sessionId: key.sessionId,
      reason,
      sourceNodeId: this.machineId,
      timestamp: Date.now(),
    });

    await this.redis.publish(channel, message);

    // Also clean up the bus entry
    await this.redis.del(redisKey);

    this.logger?.info('[TransportBus] Sent destroy-remote', {
      sessionId: key.sessionId.slice(0, 20),
      targetNodeId: nodeId,
    });
  }

  /**
   * Build the Redis key for a session in the bus.
   * Format: {prefix}{type}:{tokenHash}:{sessionId}
   */
  private busKey(key: TransportKey): string {
    return `${this.keyPrefix}${key.type}:${key.tokenHash}:${key.sessionId}`;
  }
}
