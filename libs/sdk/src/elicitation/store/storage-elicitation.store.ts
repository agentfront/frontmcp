/**
 * Storage-Based Elicitation Store
 *
 * Unified elicitation store implementation using @frontmcp/utils storage abstractions.
 * Works with Memory, Redis, and Upstash backends.
 *
 * @module elicitation/store/storage-elicitation.store
 */

import { expiresAtToTTL, TypedStorage, type NamespacedStorage, type Unsubscribe } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../../common';
import { ElicitationSubscriptionError } from '../../errors';
import { sessionIdHash } from '../../logger/session-id-hash';
import type {
  ElicitResult,
  FallbackExecutionResult,
  FallbackResultCallback,
  PendingElicitFallback,
  ResolvedElicitResult,
} from '../elicitation.types';
import type {
  ElicitationStore,
  ElicitResultCallback,
  ElicitUnsubscribe,
  PendingElicitRecord,
} from './elicitation.store';

/** Default TTL for resolved results (5 minutes) */
const RESOLVED_RESULT_TTL_SECONDS = 300;

/** Pub/sub channel prefix for elicitation results */
const RESULT_CHANNEL_PREFIX = 'result:';

/** Pub/sub channel prefix for fallback execution results */
const FALLBACK_RESULT_CHANNEL_PREFIX = 'fallback-result:';

/**
 * The route of a result: its session, with `%` and `:` escaped so the first `:` ends it, then its elicitation.
 */
function elicitationResultRoute(sessionId: string, elicitId: string): string {
  return `${sessionId.replace(/%/g, '%25').replace(/:/g, '%3A')}:${elicitId}`;
}

/**
 * The session a result subscription waits in: without it, a result could only be routed by elicitation ID.
 */
function requireSubscriberSession(elicitId: string, sessionId: string | undefined): string {
  if (!sessionId) {
    throw new ElicitationSubscriptionError(
      elicitId,
      new Error('a result subscription needs the session ID the elicitation belongs to; pass it as the third argument'),
    );
  }
  return sessionId;
}

/**
 * Elicitation store using @frontmcp/utils storage abstractions.
 *
 * Features:
 * - Uses TypedStorage for type-safe JSON serialization
 * - Uses NamespacedStorage for key prefixing
 * - Uses native pub/sub from storage adapter (works with Memory, Redis, Upstash)
 * - Automatic TTL-based expiration
 *
 * Storage layout:
 * - `pending:{sessionId}` - Pending elicitation records
 * - `fallback:{elicitId}` - Fallback context for re-invocation
 * - `resolved:{elicitId}` - Pre-resolved results for fallback flow
 * - Pub/sub channel: `result:{sessionId}:{elicitId}` - Result routing, within the session that asked
 */
export class StorageElicitationStore implements ElicitationStore {
  private readonly storage: NamespacedStorage;
  private readonly pending: TypedStorage<PendingElicitRecord>;
  private readonly fallback: TypedStorage<PendingElicitFallback>;
  private readonly resolved: TypedStorage<ResolvedElicitResult>;
  private readonly logger?: FrontMcpLogger;

  /** Local callback registry for pub/sub (maps route -> callbacks) */
  private readonly localCallbacks = new Map<string, Set<ElicitResultCallback>>();

  /** Active subscriptions (maps route -> unsubscribe function) */
  private readonly activeSubscriptions = new Map<string, Unsubscribe>();

  /** Pending subscriptions guard to prevent duplicate concurrent subscribe calls */
  private readonly pendingSubscriptions = new Map<string, Promise<Unsubscribe>>();

  /** Local callback registry for fallback results (maps route -> callbacks) */
  private readonly fallbackResultCallbacks = new Map<string, Set<FallbackResultCallback>>();

  /** Active fallback subscriptions (maps route -> unsubscribe function) */
  private readonly activeFallbackSubscriptions = new Map<string, Unsubscribe>();

  /** Pending fallback subscriptions guard */
  private readonly pendingFallbackSubscriptions = new Map<string, Promise<Unsubscribe>>();

  constructor(storage: NamespacedStorage, logger?: FrontMcpLogger) {
    this.storage = storage;
    this.logger = logger;

    // Create typed storage instances for each data type
    this.pending = new TypedStorage(storage.namespace('pending'));
    this.fallback = new TypedStorage(storage.namespace('fallback'));
    this.resolved = new TypedStorage(storage.namespace('resolved'));
  }

  // ============================================
  // Pending Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation with TTL.
   */
  async setPending(record: PendingElicitRecord): Promise<void> {
    const { sessionId, expiresAt } = record;

    // Calculate TTL from expiresAt
    const ttlSeconds = expiresAtToTTL(expiresAt);
    if (ttlSeconds <= 0) {
      this.logger?.warn('[StorageElicitationStore] Record already expired, not storing', {
        sessionIdHash: sessionIdHash(sessionId),
        elicitId: record.elicitId,
      });
      return;
    }

    await this.pending.set(sessionId, record, { ttlSeconds });

    this.logger?.debug('[StorageElicitationStore] Stored pending elicitation', {
      sessionIdHash: sessionIdHash(sessionId),
      elicitId: record.elicitId,
      ttlSeconds,
    });
  }

  /**
   * Get a pending elicitation by session ID.
   */
  async getPending(sessionId: string): Promise<PendingElicitRecord | null> {
    const record = await this.pending.get(sessionId);

    if (!record) {
      return null;
    }

    // Double-check expiration (storage TTL should handle this, but be safe)
    if (Date.now() > record.expiresAt) {
      await this.deletePending(sessionId);
      return null;
    }

    return record;
  }

  /**
   * Delete a pending elicitation by session ID.
   */
  async deletePending(sessionId: string): Promise<void> {
    await this.pending.delete(sessionId);
    this.logger?.debug('[StorageElicitationStore] Deleted pending elicitation', {
      sessionIdHash: sessionIdHash(sessionId),
    });
  }

  // ============================================
  // Pub/Sub Methods
  // ============================================

  /**
   * Subscribe to elicitation results for a specific elicit ID within the session that asked.
   * Uses in-flight subscription guard to prevent duplicate concurrent subscriptions.
   */
  async subscribeResult<T = unknown>(
    elicitId: string,
    callback: ElicitResultCallback<T>,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    const route = elicitationResultRoute(requireSubscriberSession(elicitId, sessionId), elicitId);

    // Add to local callback registry
    let callbacks = this.localCallbacks.get(route);
    if (!callbacks) {
      callbacks = new Set();
      this.localCallbacks.set(route, callbacks);
    }
    callbacks.add(callback as ElicitResultCallback);

    // Subscribe to pub/sub channel if not already subscribed and no pending subscription
    if (
      !this.activeSubscriptions.has(route) &&
      !this.pendingSubscriptions.has(route) &&
      this.storage.supportsPubSub()
    ) {
      const channel = RESULT_CHANNEL_PREFIX + route;

      // Create a pending subscription promise to guard against concurrent calls
      const subscribePromise = this.storage
        .subscribe(channel, (message) => {
          try {
            const result = JSON.parse(message) as ElicitResult<unknown>;
            const cbs = this.localCallbacks.get(route);
            if (cbs) {
              for (const cb of cbs) {
                try {
                  cb(result);
                } catch (err) {
                  this.logger?.error('[StorageElicitationStore] Callback error', {
                    elicitId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Failed to parse result message', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .then((unsubscribe) => {
          // Move from pending to active
          this.pendingSubscriptions.delete(route);
          this.activeSubscriptions.set(route, unsubscribe);
          return unsubscribe;
        })
        .catch((err) => {
          // Clean up pending entry on error
          this.pendingSubscriptions.delete(route);
          this.logger?.error('[StorageElicitationStore] Failed to subscribe', {
            elicitId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        });

      this.pendingSubscriptions.set(route, subscribePromise);

      // Wait for subscription to complete
      try {
        await subscribePromise;
      } catch (error) {
        // Remove callback on subscription failure and rethrow
        callbacks.delete(callback as ElicitResultCallback);
        if (callbacks.size === 0) {
          this.localCallbacks.delete(route);
        }
        throw error;
      }
    } else if (this.pendingSubscriptions.has(route)) {
      // If there's a pending subscription, wait for it to complete
      try {
        await this.pendingSubscriptions.get(route);
      } catch (error) {
        // Remove callback on pending subscription failure and rethrow
        callbacks.delete(callback as ElicitResultCallback);
        if (callbacks.size === 0) {
          this.localCallbacks.delete(route);
        }
        throw error;
      }
    }

    // Return unsubscribe function
    return async () => {
      callbacks.delete(callback as ElicitResultCallback);

      // If no more callbacks for this route, unsubscribe from channel
      if (callbacks.size === 0) {
        this.localCallbacks.delete(route);

        // Wait for any pending subscription to complete before cleaning up
        if (this.pendingSubscriptions.has(route)) {
          try {
            await this.pendingSubscriptions.get(route);
          } catch {
            // Ignore errors during cleanup
          }
        }

        const unsubscribe = this.activeSubscriptions.get(route);
        if (unsubscribe) {
          this.activeSubscriptions.delete(route);
          try {
            await unsubscribe();
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Failed to unsubscribe', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    };
  }

  /**
   * Publish an elicitation result to the subscribers in the session that asked.
   *
   * When pub/sub is supported, we rely entirely on the pub/sub mechanism
   * to deliver messages (even locally). This avoids double-invocation for
   * memory-based storage where pub/sub IS local.
   *
   * When pub/sub is not supported, we invoke local callbacks directly.
   */
  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    const route = elicitationResultRoute(sessionId, elicitId);
    if (this.storage.supportsPubSub()) {
      // Publish to channel - pub/sub handles both local and remote delivery
      const channel = RESULT_CHANNEL_PREFIX + route;
      try {
        await this.storage.publish(channel, JSON.stringify(result));
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to publish result', {
          elicitId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // No pub/sub - invoke local callbacks directly
      const callbacks = this.localCallbacks.get(route);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(result);
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Callback error during publish', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    // Clean up the pending record
    await this.deletePending(sessionId);

    this.logger?.debug('[StorageElicitationStore] Published result', {
      elicitId,
      sessionIdHash: sessionIdHash(sessionId),
      status: result.status,
    });
  }

  // ============================================
  // Fallback Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation fallback context.
   */
  async setPendingFallback(record: PendingElicitFallback): Promise<void> {
    const { elicitId, expiresAt } = record;

    const ttlSeconds = expiresAtToTTL(expiresAt);
    if (ttlSeconds <= 0) {
      this.logger?.warn('[StorageElicitationStore] Fallback record already expired, not storing', { elicitId });
      return;
    }

    await this.fallback.set(elicitId, record, { ttlSeconds });

    this.logger?.debug('[StorageElicitationStore] Stored pending fallback', { elicitId, ttlSeconds });
  }

  /**
   * Get a pending elicitation fallback by elicit ID.
   */
  async getPendingFallback(elicitId: string, _sessionId?: string): Promise<PendingElicitFallback | null> {
    const record = await this.fallback.get(elicitId);

    if (!record) {
      return null;
    }

    // Double-check expiration
    if (Date.now() > record.expiresAt) {
      await this.deletePendingFallback(elicitId);
      return null;
    }

    return record;
  }

  /**
   * Delete a pending elicitation fallback by elicit ID.
   */
  async deletePendingFallback(elicitId: string): Promise<void> {
    await this.fallback.delete(elicitId);
    this.logger?.debug('[StorageElicitationStore] Deleted pending fallback', { elicitId });
  }

  // ============================================
  // Resolved Result Methods
  // ============================================

  /**
   * Store a resolved elicit result for re-invocation.
   */
  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>, _sessionId?: string): Promise<void> {
    const record: ResolvedElicitResult = {
      elicitId,
      result,
      resolvedAt: Date.now(),
    };

    await this.resolved.set(elicitId, record, { ttlSeconds: RESOLVED_RESULT_TTL_SECONDS });

    this.logger?.debug('[StorageElicitationStore] Stored resolved result', { elicitId });
  }

  /**
   * Get a resolved elicit result by elicit ID.
   */
  async getResolvedResult(elicitId: string, _sessionId?: string): Promise<ResolvedElicitResult | null> {
    return this.resolved.get(elicitId);
  }

  /**
   * Delete a resolved elicit result by elicit ID.
   */
  async deleteResolvedResult(elicitId: string): Promise<void> {
    await this.resolved.delete(elicitId);
    this.logger?.debug('[StorageElicitationStore] Deleted resolved result', { elicitId });
  }

  // ============================================
  // Waiting Fallback Pub/Sub Methods
  // ============================================

  /**
   * Subscribe to fallback execution results for a specific elicit ID within the session that asked.
   * Uses in-flight subscription guard to prevent duplicate concurrent subscriptions.
   */
  async subscribeFallbackResult(
    elicitId: string,
    callback: FallbackResultCallback,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    const route = elicitationResultRoute(requireSubscriberSession(elicitId, sessionId), elicitId);

    // Add to local callback registry
    let callbacks = this.fallbackResultCallbacks.get(route);
    if (!callbacks) {
      callbacks = new Set();
      this.fallbackResultCallbacks.set(route, callbacks);
    }
    callbacks.add(callback);

    // Subscribe to pub/sub channel if not already subscribed and no pending subscription
    if (
      !this.activeFallbackSubscriptions.has(route) &&
      !this.pendingFallbackSubscriptions.has(route) &&
      this.storage.supportsPubSub()
    ) {
      const channel = FALLBACK_RESULT_CHANNEL_PREFIX + route;

      // Create a pending subscription promise to guard against concurrent calls
      const subscribePromise = this.storage
        .subscribe(channel, (message) => {
          try {
            const result = JSON.parse(message) as FallbackExecutionResult;
            const cbs = this.fallbackResultCallbacks.get(route);
            if (cbs) {
              for (const cb of cbs) {
                try {
                  cb(result);
                } catch (err) {
                  this.logger?.error('[StorageElicitationStore] Fallback callback error', {
                    elicitId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Failed to parse fallback result message', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .then((unsubscribe) => {
          // Move from pending to active
          this.pendingFallbackSubscriptions.delete(route);
          this.activeFallbackSubscriptions.set(route, unsubscribe);
          return unsubscribe;
        })
        .catch((err) => {
          // Clean up pending entry on error
          this.pendingFallbackSubscriptions.delete(route);
          this.logger?.error('[StorageElicitationStore] Failed to subscribe to fallback result', {
            elicitId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        });

      this.pendingFallbackSubscriptions.set(route, subscribePromise);

      // Wait for subscription to complete
      try {
        await subscribePromise;
      } catch (error) {
        // Remove callback on subscription failure and rethrow
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.fallbackResultCallbacks.delete(route);
        }
        throw error;
      }
    } else if (this.pendingFallbackSubscriptions.has(route)) {
      // If there's a pending subscription, wait for it to complete
      try {
        await this.pendingFallbackSubscriptions.get(route);
      } catch (error) {
        // Remove callback on pending subscription failure and rethrow
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.fallbackResultCallbacks.delete(route);
        }
        throw error;
      }
    }

    // Return unsubscribe function
    return async () => {
      callbacks.delete(callback);

      // If no more callbacks for this route, unsubscribe from channel
      if (callbacks.size === 0) {
        this.fallbackResultCallbacks.delete(route);

        // Wait for any pending subscription to complete before cleaning up
        if (this.pendingFallbackSubscriptions.has(route)) {
          try {
            await this.pendingFallbackSubscriptions.get(route);
          } catch {
            // Ignore errors during cleanup
          }
        }

        const unsubscribe = this.activeFallbackSubscriptions.get(route);
        if (unsubscribe) {
          this.activeFallbackSubscriptions.delete(route);
          try {
            await unsubscribe();
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Failed to unsubscribe from fallback result', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    };
  }

  /**
   * Publish a fallback execution result to the subscribers in the session that asked.
   *
   * When pub/sub is supported, we rely entirely on the pub/sub mechanism
   * to deliver messages (even locally). This avoids double-invocation for
   * memory-based storage where pub/sub IS local.
   *
   * When pub/sub is not supported, we invoke local callbacks directly.
   */
  async publishFallbackResult(elicitId: string, sessionId: string, result: FallbackExecutionResult): Promise<void> {
    const route = elicitationResultRoute(sessionId, elicitId);
    if (this.storage.supportsPubSub()) {
      // Publish to channel - pub/sub handles both local and remote delivery
      const channel = FALLBACK_RESULT_CHANNEL_PREFIX + route;
      try {
        await this.storage.publish(channel, JSON.stringify(result));
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to publish fallback result', {
          elicitId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      // No pub/sub - invoke local callbacks directly
      const callbacks = this.fallbackResultCallbacks.get(route);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(result);
          } catch (err) {
            this.logger?.error('[StorageElicitationStore] Fallback callback error during publish', {
              elicitId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    this.logger?.debug('[StorageElicitationStore] Published fallback result', {
      elicitId,
      sessionIdHash: sessionIdHash(sessionId),
      success: result.success,
    });
  }

  // ============================================
  // Lifecycle Methods
  // ============================================

  /**
   * Clean up store resources.
   */
  async destroy(): Promise<void> {
    // Wait for any pending subscriptions to complete
    for (const pendingPromise of this.pendingSubscriptions.values()) {
      try {
        await pendingPromise;
      } catch (err) {
        this.logger?.debug('[StorageElicitationStore] Pending subscription failed during destroy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Unsubscribe from all active subscriptions
    for (const unsubscribe of this.activeSubscriptions.values()) {
      try {
        await unsubscribe();
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to unsubscribe during destroy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Wait for any pending fallback subscriptions to complete
    for (const pendingPromise of this.pendingFallbackSubscriptions.values()) {
      try {
        await pendingPromise;
      } catch (err) {
        this.logger?.debug('[StorageElicitationStore] Pending fallback subscription failed during destroy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Unsubscribe from all active fallback subscriptions
    for (const unsubscribe of this.activeFallbackSubscriptions.values()) {
      try {
        await unsubscribe();
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to unsubscribe fallback during destroy', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.pendingSubscriptions.clear();
    this.activeSubscriptions.clear();
    this.localCallbacks.clear();
    this.pendingFallbackSubscriptions.clear();
    this.activeFallbackSubscriptions.clear();
    this.fallbackResultCallbacks.clear();

    this.logger?.debug('[StorageElicitationStore] Destroyed');
  }
}
