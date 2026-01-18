/**
 * Redis Elicitation Store
 *
 * Distributed elicitation store using Redis for persistence and pub/sub.
 * Enables elicitation state to be shared across multiple server instances.
 *
 * Storage is keyed by sessionId (only one pending elicit per session).
 * Pub/sub channels are keyed by elicitId (for cross-node result routing).
 */

import type { Redis } from 'ioredis';
import { ElicitationStore, PendingElicitRecord, ElicitResultCallback, ElicitUnsubscribe } from './elicitation.store';
import { ElicitResult, PendingElicitFallback, ResolvedElicitResult } from './elicitation.types';
import { FrontMcpLogger } from '../common/interfaces/logger.interface';

/**
 * Key prefix for pending elicitation records (keyed by sessionId).
 */
const PENDING_KEY_PREFIX = 'mcp:elicit:session:';

/**
 * Channel prefix for elicitation result pub/sub.
 */
const RESULT_CHANNEL_PREFIX = 'mcp:elicit:result:';

/**
 * Key prefix for pending fallback elicitation records (keyed by elicitId).
 */
const FALLBACK_KEY_PREFIX = 'mcp:elicit:fallback:';

/**
 * Key prefix for resolved elicit results (keyed by elicitId).
 */
const RESOLVED_KEY_PREFIX = 'mcp:elicit:resolved:';

/**
 * Redis-backed elicitation store for distributed deployments.
 *
 * Features:
 * - Redis-backed persistence with automatic TTL expiration
 * - Pub/sub for cross-node result routing
 * - Dedicated subscriber connection to avoid blocking
 *
 * Usage:
 * ```typescript
 * const store = new RedisElicitationStore(redisClient, logger);
 *
 * // Node A: Store pending and subscribe
 * await store.setPending(record);
 * const unsub = await store.subscribeResult(elicitId, (result) => {
 *   // Handle result
 * });
 *
 * // Node B (or any node): Publish result
 * await store.publishResult(elicitId, result);
 * ```
 */
export class RedisElicitationStore implements ElicitationStore {
  /**
   * Dedicated Redis connection for subscriptions.
   * Redis pub/sub requires a separate connection because a subscribed
   * connection cannot issue other commands.
   */
  private subscriber: Redis | undefined;

  /** Active subscriptions by channel */
  private subscriptions = new Map<string, Set<ElicitResultCallback>>();

  /** Track if subscriber is connected */
  private subscriberReady = false;

  constructor(
    private readonly redis: Redis,
    private readonly logger?: FrontMcpLogger,
  ) {
    // Create dedicated subscriber connection by duplicating the main connection
    // This inherits connection settings but creates a new TCP connection
    this.subscriber = redis.duplicate();

    // Set up message handler
    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message);
    });

    this.subscriber.on('ready', () => {
      this.subscriberReady = true;
      this.logger?.verbose('[RedisElicitationStore] Subscriber connection ready');
    });

    this.subscriber.on('error', (err) => {
      this.logger?.error('[RedisElicitationStore] Subscriber error', { error: err.message });
    });
  }

  /**
   * Store a pending elicitation with TTL.
   * Keyed by sessionId. The record automatically expires based on `expiresAt`.
   */
  async setPending(record: PendingElicitRecord): Promise<void> {
    const key = PENDING_KEY_PREFIX + record.sessionId;
    const ttlMs = Math.max(0, record.expiresAt - Date.now());
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    // If TTL is already expired or invalid, delete any existing key and return early
    // Redis SET EX 0 would fail, so we handle this edge case explicitly
    if (ttlSeconds <= 0) {
      await this.redis.del(key);
      this.logger?.warn('[RedisElicitationStore] Pending elicitation already expired, deleted key', {
        elicitId: record.elicitId,
        sessionId: record.sessionId.slice(0, 20),
        ttlSeconds,
      });
      return;
    }

    await this.redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);

    this.logger?.verbose('[RedisElicitationStore] Stored pending elicitation', {
      elicitId: record.elicitId,
      sessionId: record.sessionId.slice(0, 20),
      ttlSeconds,
    });
  }

  /**
   * Get a pending elicitation by session ID.
   */
  async getPending(sessionId: string): Promise<PendingElicitRecord | null> {
    const key = PENDING_KEY_PREFIX + sessionId;
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      const record = JSON.parse(raw) as PendingElicitRecord;

      // Double-check expiration (Redis TTL might be slightly off)
      if (Date.now() > record.expiresAt) {
        await this.deletePending(sessionId);
        return null;
      }

      return record;
    } catch (error) {
      this.logger?.warn('[RedisElicitationStore] Failed to parse pending record', {
        sessionId: sessionId.slice(0, 20),
        error: (error as Error).message,
      });
      await this.deletePending(sessionId);
      return null;
    }
  }

  /**
   * Delete a pending elicitation by session ID.
   */
  async deletePending(sessionId: string): Promise<void> {
    const key = PENDING_KEY_PREFIX + sessionId;
    await this.redis.del(key);

    this.logger?.verbose('[RedisElicitationStore] Deleted pending elicitation', {
      sessionId: sessionId.slice(0, 20),
    });
  }

  /**
   * Subscribe to elicitation results for a specific elicit ID.
   * Creates a Redis pub/sub subscription on the dedicated subscriber connection.
   */
  async subscribeResult<T = unknown>(elicitId: string, callback: ElicitResultCallback<T>): Promise<ElicitUnsubscribe> {
    const channel = RESULT_CHANNEL_PREFIX + elicitId;
    const subscriber = this.subscriber;

    // Wait for subscriber to be ready
    if (!this.subscriberReady && subscriber) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Subscriber connection timeout'));
        }, 5000);

        subscriber.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        // If already ready, resolve immediately
        if (this.subscriberReady) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    // Track callback locally
    let callbacks = this.subscriptions.get(channel);
    if (!callbacks) {
      callbacks = new Set();
      this.subscriptions.set(channel, callbacks);

      // Subscribe to Redis channel
      await subscriber?.subscribe(channel);

      this.logger?.verbose('[RedisElicitationStore] Subscribed to result channel', {
        elicitId,
        channel,
      });
    }

    callbacks.add(callback as ElicitResultCallback);

    // Return unsubscribe function
    return async () => {
      const callbacks = this.subscriptions.get(channel);
      if (callbacks) {
        callbacks.delete(callback as ElicitResultCallback);

        // If no more callbacks for this channel, unsubscribe from Redis
        if (callbacks.size === 0) {
          this.subscriptions.delete(channel);
          await this.subscriber?.unsubscribe(channel);

          this.logger?.verbose('[RedisElicitationStore] Unsubscribed from result channel', {
            elicitId,
            channel,
          });
        }
      }
    };
  }

  /**
   * Publish an elicitation result via Redis pub/sub.
   * This reaches all nodes subscribed to this elicit ID.
   */
  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    const channel = RESULT_CHANNEL_PREFIX + elicitId;

    // Publish to Redis - reaches all subscribed nodes
    const subscriberCount = await this.redis.publish(channel, JSON.stringify(result));

    this.logger?.verbose('[RedisElicitationStore] Published elicitation result', {
      elicitId,
      sessionId: sessionId.slice(0, 20),
      channel,
      subscriberCount,
      status: result.status,
    });

    // Clean up the pending record by sessionId
    await this.deletePending(sessionId);
  }

  /**
   * Handle incoming pub/sub message.
   */
  private handleMessage(channel: string, message: string): void {
    const callbacks = this.subscriptions.get(channel);
    if (!callbacks || callbacks.size === 0) {
      return;
    }

    try {
      const result = JSON.parse(message) as ElicitResult;

      // Call all registered callbacks
      for (const callback of callbacks) {
        try {
          callback(result);
        } catch (error) {
          this.logger?.warn('[RedisElicitationStore] Callback error', {
            channel,
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      this.logger?.warn('[RedisElicitationStore] Failed to parse pub/sub message', {
        channel,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Clean up resources.
   */
  async destroy(): Promise<void> {
    // Unsubscribe from all channels
    for (const channel of this.subscriptions.keys()) {
      await this.subscriber?.unsubscribe(channel);
    }
    this.subscriptions.clear();

    // Disconnect subscriber
    if (this.subscriber) {
      this.subscriber.disconnect();
      this.subscriber = undefined;
    }

    this.logger?.verbose('[RedisElicitationStore] Destroyed');
  }

  // ============================================
  // Fallback Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation fallback context.
   * Keyed by elicitId. The record automatically expires based on `expiresAt`.
   */
  async setPendingFallback(record: PendingElicitFallback): Promise<void> {
    const key = FALLBACK_KEY_PREFIX + record.elicitId;
    const ttlMs = Math.max(0, record.expiresAt - Date.now());
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    // If TTL is already expired or invalid, delete any existing key and return early
    if (ttlSeconds <= 0) {
      await this.redis.del(key);
      this.logger?.warn('[RedisElicitationStore] Pending fallback already expired, deleted key', {
        elicitId: record.elicitId,
        ttlSeconds,
      });
      return;
    }

    await this.redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);

    this.logger?.verbose('[RedisElicitationStore] Stored pending fallback', {
      elicitId: record.elicitId,
      toolName: record.toolName,
      ttlSeconds,
    });
  }

  /**
   * Get a pending elicitation fallback by elicit ID.
   */
  async getPendingFallback(elicitId: string): Promise<PendingElicitFallback | null> {
    const key = FALLBACK_KEY_PREFIX + elicitId;
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      const record = JSON.parse(raw) as PendingElicitFallback;

      // Double-check expiration
      if (Date.now() > record.expiresAt) {
        await this.deletePendingFallback(elicitId);
        return null;
      }

      return record;
    } catch (error) {
      this.logger?.warn('[RedisElicitationStore] Failed to parse pending fallback', {
        elicitId,
        error: (error as Error).message,
      });
      await this.deletePendingFallback(elicitId);
      return null;
    }
  }

  /**
   * Delete a pending elicitation fallback by elicit ID.
   */
  async deletePendingFallback(elicitId: string): Promise<void> {
    const key = FALLBACK_KEY_PREFIX + elicitId;
    await this.redis.del(key);

    this.logger?.verbose('[RedisElicitationStore] Deleted pending fallback', {
      elicitId,
    });
  }

  /**
   * Store a resolved elicit result for re-invocation.
   * Uses a short TTL (5 minutes) since this is only needed during the re-invocation window.
   */
  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>): Promise<void> {
    const key = RESOLVED_KEY_PREFIX + elicitId;
    const resolved: ResolvedElicitResult = {
      elicitId,
      result,
      resolvedAt: Date.now(),
    };

    // Store with 5-minute TTL (300 seconds)
    await this.redis.set(key, JSON.stringify(resolved), 'EX', 300);

    this.logger?.verbose('[RedisElicitationStore] Stored resolved result', {
      elicitId,
      status: result.status,
    });
  }

  /**
   * Get a resolved elicit result by elicit ID.
   */
  async getResolvedResult(elicitId: string): Promise<ResolvedElicitResult | null> {
    const key = RESOLVED_KEY_PREFIX + elicitId;
    const raw = await this.redis.get(key);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as ResolvedElicitResult;
    } catch (error) {
      this.logger?.warn('[RedisElicitationStore] Failed to parse resolved result', {
        elicitId,
        error: (error as Error).message,
      });
      await this.deleteResolvedResult(elicitId);
      return null;
    }
  }

  /**
   * Delete a resolved elicit result by elicit ID.
   */
  async deleteResolvedResult(elicitId: string): Promise<void> {
    const key = RESOLVED_KEY_PREFIX + elicitId;
    await this.redis.del(key);

    this.logger?.verbose('[RedisElicitationStore] Deleted resolved result', {
      elicitId,
    });
  }
}
