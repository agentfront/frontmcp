/**
 * Redis Transport Bus — Distributed Session Location Registry
 *
 * Maps sessions to the pods that own them using one Redis Hash per session id.
 * Used by TransportService in distributed mode to discover which pod owns a
 * given session, and to relay a request for it to that pod.
 */

import type { ServerRequest, ServerResponse } from '../../common';
import { SessionOwnerUnreachableError } from '../../errors/transport.errors';
import { isRelayedRequest, serializeRelayRequest } from '../relay/relay-http';
import type { SessionRelay } from '../relay/session-relay';
import type { RemoteLocation, TransportBus, TransportKey } from '../transport.types';

/**
 * Minimal Redis client interface for the transport bus.
 * Subset of ioredis — allows plugging any compatible client.
 */
export interface BusRedisClient {
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Default key prefix for bus keys. */
const DEFAULT_BUS_PREFIX = 'mcp:bus:';

/** Default TTL for bus entries (seconds). Matches session default of 1 hour. */
const DEFAULT_BUS_TTL_SECONDS = 3600;

/** `Retry-After` for a request that cannot be relayed (the default heartbeat TTL). */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/**
 * Lua script for atomic advertise: the entry never exists without its TTL.
 * KEYS[1] = bus key, ARGV = nodeId, channel, type, tokenHash, TTL (seconds)
 */
const ADVERTISE_LUA = `
redis.call('HSET', KEYS[1], 'nodeId', ARGV[1], 'channel', ARGV[2], 'type', ARGV[3], 'tokenHash', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

/**
 * Lua CAS script for atomic revoke: only delete if nodeId still matches.
 * KEYS[1] = bus key, ARGV[1] = expected nodeId
 * Returns 1 if deleted, 0 if owned by another node or not found.
 */
const REVOKE_LUA = `
local nodeId = redis.call('HGET', KEYS[1], 'nodeId')
if nodeId == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

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
  /** `Retry-After` (seconds) given when a request cannot be relayed. @default 30 */
  retryAfterSeconds?: number;
  /** Logger (optional) */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    debug: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/** A session's entry on the bus. */
interface BusEntry extends RemoteLocation {
  type?: string;
  tokenHash?: string;
}

/**
 * Redis-backed TransportBus implementation.
 *
 * For each session id, stores a Hash with the owning node, its relay channel,
 * and the session's transport type and token hash. Requests are relayed to the
 * owner through the {@link SessionRelay} attached with {@link attachRelay}.
 */
export class RedisTransportBus implements TransportBus {
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly haKeyPrefix: string;
  private readonly retryAfterSeconds: number;
  private readonly logger?: RedisTransportBusOptions['logger'];
  private relay?: SessionRelay;

  constructor(
    private readonly redis: BusRedisClient,
    private readonly machineId: string,
    options?: RedisTransportBusOptions,
  ) {
    this.keyPrefix = options?.keyPrefix ?? DEFAULT_BUS_PREFIX;
    this.ttlSeconds = options?.ttlSeconds ?? DEFAULT_BUS_TTL_SECONDS;
    this.haKeyPrefix = options?.haKeyPrefix ?? 'mcp:ha:';
    this.retryAfterSeconds = options?.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
    this.logger = options?.logger;
  }

  nodeId(): string {
    return this.machineId;
  }

  /** Attach the relay that serves requests on their session's owner. */
  attachRelay(relay: SessionRelay | undefined): void {
    this.relay = relay;
  }

  canRelay(): boolean {
    return this.relay !== undefined;
  }

  channelOf(nodeId: string): string {
    return `${this.haKeyPrefix}notify:${nodeId}`;
  }

  /**
   * Advertise that this node owns a session.
   * Stores the nodeId, relay channel, type and token hash in a Redis Hash, with its TTL, atomically.
   */
  async advertise(key: TransportKey): Promise<void> {
    await this.redis.eval(
      ADVERTISE_LUA,
      1,
      this.busKey(key.sessionId),
      this.machineId,
      this.channelOf(this.machineId),
      key.type,
      key.tokenHash,
      this.ttlSeconds,
    );

    this.logger?.debug('[TransportBus] Advertised session', {
      sessionId: key.sessionId.slice(0, 20),
      nodeId: this.machineId,
    });
  }

  /**
   * Revoke ownership of a session (e.g., on transport dispose).
   * Uses atomic compare-and-delete to avoid removing a newer owner's registration.
   */
  async revoke(key: TransportKey): Promise<void> {
    const redisKey = this.busKey(key.sessionId);

    // Atomic CAS: only delete if we still own this session
    const result = await this.redis.eval(REVOKE_LUA, 1, redisKey, this.machineId);

    this.logger?.debug('[TransportBus] Revoked session', {
      sessionId: key.sessionId.slice(0, 20),
      deleted: result === 1,
    });
  }

  /**
   * Look up which other node owns this exact session (same transport type and token).
   * Returns null if the session is not registered, belongs to another token, or is ours.
   */
  async lookup(key: TransportKey): Promise<RemoteLocation | null> {
    const entry = await this.readEntry(key.sessionId);
    if (!entry) return null;

    // Skip if we own this session — caller should use local transport
    if (entry.nodeId === this.machineId) return null;

    // The entry must describe the same session: same transport and same token.
    if ((entry.type && entry.type !== key.type) || (entry.tokenHash && entry.tokenHash !== key.tokenHash)) {
      return null;
    }

    return { nodeId: entry.nodeId, channel: entry.channel };
  }

  /** The node owning a session id (this node included), whatever its type or token. */
  async lookupOwner(sessionId: string): Promise<RemoteLocation | null> {
    const entry = await this.readEntry(sessionId);
    return entry ? { nodeId: entry.nodeId, channel: entry.channel } : null;
  }

  /**
   * Relay a request to the node owning its session and write that node's response.
   *
   * A request that was itself relayed here is never relayed again (one hop at most).
   * @throws SessionOwnerUnreachableError when the request cannot be served by the owner.
   */
  async proxyRequest(
    location: RemoteLocation,
    sessionId: string,
    request: ServerRequest,
    response: ServerResponse,
  ): Promise<void> {
    if (isRelayedRequest(request)) {
      throw new SessionOwnerUnreachableError(
        location.nodeId,
        this.retryAfterSeconds,
        'the request was already relayed once and its session moved again',
      );
    }
    if (!this.relay) {
      throw new SessionOwnerUnreachableError(
        location.nodeId,
        this.retryAfterSeconds,
        'request relay is not available on this node (no Redis pub/sub)',
      );
    }
    await this.relay.forward(location.nodeId, sessionId, serializeRelayRequest(request), response);
  }

  /**
   * Destroy a session on a remote node via pub/sub relay.
   */
  async destroyRemote(key: TransportKey, reason?: string): Promise<void> {
    const entry = await this.readEntry(key.sessionId);
    if (!entry || entry.nodeId === this.machineId) return;

    const message = JSON.stringify({
      kind: 'destroy-session',
      sessionId: key.sessionId,
      reason,
      sourceNodeId: this.machineId,
      timestamp: Date.now(),
    });

    await this.redis.publish(entry.channel, message);

    // Let the owning node revoke after it destroys the transport.
    // Don't blindly delete — another node may have already taken ownership.

    this.logger?.info('[TransportBus] Sent destroy-remote', {
      sessionId: key.sessionId.slice(0, 20),
      targetNodeId: entry.nodeId,
    });
  }

  private async readEntry(sessionId: string): Promise<BusEntry | null> {
    const fields = await this.redis.hgetall(this.busKey(sessionId));
    const nodeId = fields?.['nodeId'];
    if (!nodeId) return null;
    return {
      nodeId,
      channel: fields['channel'] || this.channelOf(nodeId),
      type: fields['type'] || undefined,
      tokenHash: fields['tokenHash'] || undefined,
    };
  }

  /**
   * Build the Redis key for a session in the bus.
   * Format: {prefix}session:{sessionId}
   */
  private busKey(sessionId: string): string {
    return `${this.keyPrefix}session:${sessionId}`;
  }
}
