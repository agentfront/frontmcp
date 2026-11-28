/**
 * Redis Transport Bus — Distributed Session Location Registry
 *
 * Maps sessions to the pods that own them using one Redis Hash per session id.
 * Used by TransportService in distributed mode to discover which pod owns a
 * given session, and to relay a request for it to that pod.
 */

import { publishRedisMessage, randomUUID, type FrontMcpRedisClient } from '@frontmcp/utils';

import type { ServerRequest, ServerResponse } from '../../common';
import { SessionEndUnconfirmedError, SessionOwnerUnreachableError } from '../../errors/transport.errors';
import type { DestroySessionRelayMessage, SessionDestroyedRelayMessage } from '../../ha/relay-messages';
import { isRelayedRequest, serializeRelayRequest } from '../relay/relay-http';
import type { SessionRelay } from '../relay/session-relay';
import type { RemoteLocation, TransportBus, TransportKey } from '../transport.types';

/**
 * Minimal Redis client interface for the transport bus.
 * Subset of ioredis — allows plugging any compatible client.
 */
export interface BusRedisClient extends Partial<Pick<FrontMcpRedisClient, 'isCluster' | 'nodes'>> {
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

/** How long a remote destroy waits for the owner to confirm it closed the session, and how often it reads the entry. */
const RELEASE_TIMEOUT_MS = 5_000;
const RELEASE_POLL_MS = 25;

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
  /** Remote destroys waiting for the owner's `session-destroyed` answer, by request id. */
  private readonly pendingDestroys = new Map<string, { ownerNodeId: string; confirm(): void }>();

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
   * Ask the node that owns a session to close it, and resolve once it did (#1446): closing the session's
   * transport stops its calls in flight. The owner confirms with a `session-destroyed` answer on this
   * node's channel; when this node does not listen on its channel, or the owner runs a version before 1.14,
   * the confirmation is its bus entry gone, which the owner revokes after it closed the transport. An entry
   * another node took over does not confirm anything: the owner's calls may still run.
   *
   * @throws SessionEndUnconfirmedError `not-listening` when no node listens on the owner's channel, so it
   *   cannot be asked (it stopped, or it cannot hear yet); `timed-out` when the owner did not confirm within
   *   5 s.
   */
  async destroyRemote(key: TransportKey, reason?: string): Promise<void> {
    const entry = await this.readEntry(key.sessionId);
    if (!entry || entry.nodeId === this.machineId) return;

    const requestId = randomUUID();
    const confirmed = new Promise<void>((confirm) =>
      this.pendingDestroys.set(requestId, { ownerNodeId: entry.nodeId, confirm }),
    );
    try {
      const message: DestroySessionRelayMessage = {
        kind: 'destroy-session',
        sessionId: key.sessionId,
        reason,
        sourceNodeId: this.machineId,
        timestamp: Date.now(),
        requestId,
      };
      // Counted on every node of a cluster, whose PUBLISH counts only its own node's subscribers
      const receivers = await publishRedisMessage(this.redis, entry.channel, JSON.stringify(message));
      this.logger?.info('[TransportBus] Sent destroy-remote', {
        sessionId: key.sessionId.slice(0, 20),
        targetNodeId: entry.nodeId,
      });
      if (receivers === 0) {
        throw new SessionEndUnconfirmedError(
          entry.nodeId,
          this.retryAfterSeconds,
          "no node listens on the session owner's relay channel",
          'not-listening',
        );
      }
      if (await this.untilClosed(key.sessionId, confirmed)) return;
      this.logger?.warn('[TransportBus] The session owner did not confirm in time that it closed the session', {
        sessionId: key.sessionId.slice(0, 20),
        ownerNodeId: entry.nodeId,
      });
      throw new SessionEndUnconfirmedError(
        entry.nodeId,
        this.retryAfterSeconds,
        `the session owner did not confirm within ${RELEASE_TIMEOUT_MS}ms that it closed the session`,
        'timed-out',
      );
    } finally {
      this.pendingDestroys.delete(requestId);
    }
  }

  /** The owner's answer to a destroy this node sent: it closed the session (or held none). */
  handleSessionDestroyed(message: SessionDestroyedRelayMessage): void {
    const pending = this.pendingDestroys.get(message.requestId);
    if (pending && pending.ownerNodeId === message.sourceNodeId) pending.confirm();
  }

  /** Revoke this node's entry for a session it holds no transport for, so no node waits on it. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.eval(REVOKE_LUA, 1, this.busKey(sessionId), this.machineId);
  }

  /** Whether the owner confirmed, or revoked the session's entry, within the bounded wait. */
  private async untilClosed(sessionId: string, confirmed: Promise<void>): Promise<boolean> {
    let waiting = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const revoked = (async () => {
      while (waiting) {
        await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS));
        try {
          if (waiting && !(await this.readEntry(sessionId))) return true;
        } catch {
          // A failed read decides nothing: the answer or the deadline does
        }
      }
      return false;
    })();
    // The deadline bounds the reads too: a Redis that never answers one cannot hold the DELETE open.
    const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), RELEASE_TIMEOUT_MS)));
    return Promise.race([confirmed.then(() => true), revoked, timedOut]).finally(() => {
      waiting = false;
      clearTimeout(timer);
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
