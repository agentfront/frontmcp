/**
 * Heartbeat Service
 *
 * Writes a TTL key to Redis at a regular interval to signal pod liveness.
 * When a pod dies, its heartbeat key expires and other pods can detect the death.
 */

import { DEFAULT_HA_CONFIG, type HaConfig, type HeartbeatValue } from './ha.types';

/**
 * Minimal Redis client interface (subset of ioredis).
 * Allows the service to work with any Redis-compatible client.
 */
export interface HeartbeatRedisClient {
  set(key: string, value: string, expiryMode: 'PX', time: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly startedAt: number;
  private readonly keyPrefix: string;
  private readonly intervalMs: number;
  private readonly ttlMs: number;
  private sessionCount = 0;

  constructor(
    private readonly redis: HeartbeatRedisClient,
    private readonly nodeId: string,
    config?: Partial<HaConfig>,
  ) {
    this.startedAt = Date.now();
    this.keyPrefix = config?.redisKeyPrefix ?? DEFAULT_HA_CONFIG.redisKeyPrefix;
    this.intervalMs = config?.heartbeatIntervalMs ?? DEFAULT_HA_CONFIG.heartbeatIntervalMs;
    this.ttlMs = config?.heartbeatTtlMs ?? DEFAULT_HA_CONFIG.heartbeatTtlMs;
  }

  /** Start the heartbeat interval. */
  start(): void {
    if (this.timer) return;
    // Write immediately, then on interval
    this.writeHeartbeat();
    this.timer = setInterval(() => this.writeHeartbeat(), this.intervalMs);
    if (this.timer.unref) this.timer.unref(); // Don't block process exit
  }

  /** Stop the heartbeat and remove the key. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    try {
      await this.redis.del(this.heartbeatKey());
    } catch {
      // Best-effort cleanup
    }
  }

  /** Update the tracked session count (for monitoring). */
  setSessionCount(count: number): void {
    this.sessionCount = count;
  }

  /** Check if a specific node's heartbeat is alive. */
  async isAlive(nodeId: string): Promise<boolean> {
    const exists = await this.redis.exists(`${this.keyPrefix}heartbeat:${nodeId}`);
    return exists === 1;
  }

  /** Get the heartbeat value for a specific node. */
  async getHeartbeat(nodeId: string): Promise<HeartbeatValue | null> {
    const raw = await this.redis.get(`${this.keyPrefix}heartbeat:${nodeId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as HeartbeatValue;
    } catch {
      return null;
    }
  }

  /** Get all alive node IDs by scanning heartbeat keys. */
  async getAliveNodes(): Promise<string[]> {
    const keys = await this.redis.keys(`${this.keyPrefix}heartbeat:*`);
    return keys.map((key) => key.slice(`${this.keyPrefix}heartbeat:`.length));
  }

  private heartbeatKey(): string {
    return `${this.keyPrefix}heartbeat:${this.nodeId}`;
  }

  private writeHeartbeat(): void {
    const value: HeartbeatValue = {
      nodeId: this.nodeId,
      startedAt: this.startedAt,
      lastBeat: Date.now(),
      sessionCount: this.sessionCount,
    };
    // Fire-and-forget — if Redis is down, the key just expires
    this.redis.set(this.heartbeatKey(), JSON.stringify(value), 'PX', this.ttlMs).catch(() => {});
  }
}
