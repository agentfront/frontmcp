/**
 * Storage-Based Elicitation Store
 *
 * Unified elicitation store implementation using @frontmcp/utils storage abstractions.
 * Works with Memory, Redis, and Upstash backends.
 *
 * @module elicitation/store/storage-elicitation.store
 */

import type { NamespacedStorage, Unsubscribe } from '@frontmcp/utils';
import { TypedStorage } from '@frontmcp/utils';
import type { FrontMcpLogger } from '../../common';
import type {
  ElicitationStore,
  PendingElicitRecord,
  ElicitResultCallback,
  ElicitUnsubscribe,
} from './elicitation.store';
import type { ElicitResult, PendingElicitFallback, ResolvedElicitResult } from '../elicitation.types';
import { expiresAtToTTL } from '@frontmcp/utils';

/** Default TTL for resolved results (5 minutes) */
const RESOLVED_RESULT_TTL_SECONDS = 300;

/** Pub/sub channel prefix for elicitation results */
const RESULT_CHANNEL_PREFIX = 'result:';

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
 * - Pub/sub channel: `result:{elicitId}` - Result routing
 */
export class StorageElicitationStore implements ElicitationStore {
  private readonly storage: NamespacedStorage;
  private readonly pending: TypedStorage<PendingElicitRecord>;
  private readonly fallback: TypedStorage<PendingElicitFallback>;
  private readonly resolved: TypedStorage<ResolvedElicitResult>;
  private readonly logger?: FrontMcpLogger;

  /** Local callback registry for pub/sub (maps elicitId -> callbacks) */
  private readonly localCallbacks = new Map<string, Set<ElicitResultCallback>>();

  /** Active subscriptions (maps elicitId -> unsubscribe function) */
  private readonly activeSubscriptions = new Map<string, Unsubscribe>();

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
        sessionId,
        elicitId: record.elicitId,
      });
      return;
    }

    await this.pending.set(sessionId, record, { ttlSeconds });

    this.logger?.debug('[StorageElicitationStore] Stored pending elicitation', {
      sessionId,
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
    this.logger?.debug('[StorageElicitationStore] Deleted pending elicitation', { sessionId });
  }

  // ============================================
  // Pub/Sub Methods
  // ============================================

  /**
   * Subscribe to elicitation results for a specific elicit ID.
   */
  async subscribeResult<T = unknown>(elicitId: string, callback: ElicitResultCallback<T>): Promise<ElicitUnsubscribe> {
    // Add to local callback registry
    let callbacks = this.localCallbacks.get(elicitId);
    if (!callbacks) {
      callbacks = new Set();
      this.localCallbacks.set(elicitId, callbacks);
    }
    callbacks.add(callback as ElicitResultCallback);

    // Subscribe to pub/sub channel if not already subscribed
    if (!this.activeSubscriptions.has(elicitId) && this.storage.supportsPubSub()) {
      const channel = RESULT_CHANNEL_PREFIX + elicitId;

      try {
        const unsubscribe = await this.storage.subscribe(channel, (message) => {
          try {
            const result = JSON.parse(message) as ElicitResult<unknown>;
            const cbs = this.localCallbacks.get(elicitId);
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
        });

        this.activeSubscriptions.set(elicitId, unsubscribe);
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to subscribe', {
          elicitId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Return unsubscribe function
    return async () => {
      callbacks.delete(callback as ElicitResultCallback);

      // If no more callbacks for this elicitId, unsubscribe from channel
      if (callbacks.size === 0) {
        this.localCallbacks.delete(elicitId);

        const unsubscribe = this.activeSubscriptions.get(elicitId);
        if (unsubscribe) {
          this.activeSubscriptions.delete(elicitId);
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
   * Publish an elicitation result.
   */
  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    // First, invoke local callbacks directly for same-node responses
    const callbacks = this.localCallbacks.get(elicitId);
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

    // Publish to channel for cross-node routing
    if (this.storage.supportsPubSub()) {
      const channel = RESULT_CHANNEL_PREFIX + elicitId;
      try {
        await this.storage.publish(channel, JSON.stringify(result));
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to publish result', {
          elicitId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Clean up the pending record
    await this.deletePending(sessionId);

    this.logger?.debug('[StorageElicitationStore] Published result', { elicitId, sessionId, status: result.status });
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
  async getPendingFallback(elicitId: string): Promise<PendingElicitFallback | null> {
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
  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>): Promise<void> {
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
  async getResolvedResult(elicitId: string): Promise<ResolvedElicitResult | null> {
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
  // Lifecycle Methods
  // ============================================

  /**
   * Clean up store resources.
   */
  async destroy(): Promise<void> {
    // Unsubscribe from all active subscriptions
    for (const [elicitId, unsubscribe] of this.activeSubscriptions) {
      try {
        await unsubscribe();
      } catch (err) {
        this.logger?.error('[StorageElicitationStore] Failed to unsubscribe during destroy', {
          elicitId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.activeSubscriptions.clear();
    this.localCallbacks.clear();

    this.logger?.debug('[StorageElicitationStore] Destroyed');
  }
}
