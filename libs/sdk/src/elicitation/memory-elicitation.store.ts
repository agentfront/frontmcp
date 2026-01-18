/**
 * In-Memory Elicitation Store
 *
 * Fallback store for single-node deployments and development.
 * Uses local Maps for storage and event emission for pub/sub.
 *
 * @warning This store does NOT work in distributed environments.
 * Use RedisElicitationStore for multi-node deployments.
 */

import { ElicitationStore, PendingElicitRecord, ElicitResultCallback, ElicitUnsubscribe } from './elicitation.store';
import { ElicitResult, PendingElicitFallback, ResolvedElicitResult } from './elicitation.types';

/**
 * In-memory elicitation store for single-node deployments.
 *
 * Features:
 * - Local Map storage with automatic expiration (keyed by sessionId)
 * - In-process pub/sub via callback registry (keyed by elicitId)
 * - Zero external dependencies
 *
 * Limitations:
 * - Does not support multi-node deployments
 * - State is lost on server restart
 * - No cross-process communication
 */
export class InMemoryElicitationStore implements ElicitationStore {
  /** Pending elicitations by sessionId (only one per session allowed) */
  private pending = new Map<string, PendingElicitRecord>();

  /** Result listeners by elicitId (for pub/sub routing) */
  private listeners = new Map<string, Set<ElicitResultCallback>>();

  /** Expiration timers by sessionId */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  // ============================================
  // Fallback Elicitation Storage
  // ============================================

  /** Pending fallback elicitations by elicitId */
  private pendingFallback = new Map<string, PendingElicitFallback>();

  /** Resolved elicit results by elicitId */
  private resolvedResults = new Map<string, ResolvedElicitResult>();

  /** Expiration timers for fallback records by elicitId */
  private fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Expiration timers for resolved results by elicitId */
  private resolvedTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Store a pending elicitation with TTL.
   * Keyed by sessionId. Sets up automatic expiration based on `expiresAt`.
   */
  async setPending(record: PendingElicitRecord): Promise<void> {
    const { sessionId } = record;

    // Clear any existing timer for this session
    const existingTimer = this.timers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Also clean up any existing listeners for the old elicitId
    const existingRecord = this.pending.get(sessionId);
    if (existingRecord) {
      this.listeners.delete(existingRecord.elicitId);
    }

    this.pending.set(sessionId, record);

    // Set up expiration timer
    const ttlMs = Math.max(0, record.expiresAt - Date.now());
    const timer = setTimeout(() => {
      this.pending.delete(sessionId);
      this.timers.delete(sessionId);
      this.listeners.delete(record.elicitId);
    }, ttlMs);

    this.timers.set(sessionId, timer);
  }

  /**
   * Get a pending elicitation by session ID.
   * Returns null if not found or expired.
   */
  async getPending(sessionId: string): Promise<PendingElicitRecord | null> {
    const record = this.pending.get(sessionId);
    if (!record) {
      return null;
    }

    // Check if expired
    if (Date.now() > record.expiresAt) {
      await this.deletePending(sessionId);
      return null;
    }

    return record;
  }

  /**
   * Delete a pending elicitation by session ID and clean up resources.
   */
  async deletePending(sessionId: string): Promise<void> {
    const record = this.pending.get(sessionId);
    if (record) {
      this.listeners.delete(record.elicitId);
    }

    this.pending.delete(sessionId);

    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  /**
   * Subscribe to elicitation results for a specific elicit ID.
   * In-memory implementation uses local callback registry.
   */
  async subscribeResult<T = unknown>(elicitId: string, callback: ElicitResultCallback<T>): Promise<ElicitUnsubscribe> {
    let listeners = this.listeners.get(elicitId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(elicitId, listeners);
    }

    listeners.add(callback as ElicitResultCallback);

    // Return unsubscribe function
    return async () => {
      listeners.delete(callback as ElicitResultCallback);
      if (listeners.size === 0) {
        this.listeners.delete(elicitId);
      }
    };
  }

  /**
   * Publish an elicitation result to all listeners.
   * In-memory implementation synchronously calls all registered callbacks.
   */
  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    const listeners = this.listeners.get(elicitId);

    if (listeners) {
      // Call all listeners
      for (const callback of listeners) {
        try {
          callback(result);
        } catch {
          // Ignore callback errors
        }
      }
    }

    // Clean up the pending record by sessionId
    await this.deletePending(sessionId);
  }

  /**
   * Clean up all resources.
   */
  async destroy(): Promise<void> {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.fallbackTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.resolvedTimers.values()) {
      clearTimeout(timer);
    }

    this.pending.clear();
    this.listeners.clear();
    this.timers.clear();
    this.pendingFallback.clear();
    this.resolvedResults.clear();
    this.fallbackTimers.clear();
    this.resolvedTimers.clear();
  }

  // ============================================
  // Fallback Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation fallback context.
   * Keyed by elicitId. Sets up automatic expiration based on `expiresAt`.
   */
  async setPendingFallback(record: PendingElicitFallback): Promise<void> {
    const { elicitId } = record;

    // Clear any existing timer for this elicitId
    const existingTimer = this.fallbackTimers.get(elicitId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.pendingFallback.set(elicitId, record);

    // Set up expiration timer
    const ttlMs = Math.max(0, record.expiresAt - Date.now());
    const timer = setTimeout(() => {
      this.pendingFallback.delete(elicitId);
      this.fallbackTimers.delete(elicitId);
      this.resolvedResults.delete(elicitId);
    }, ttlMs);

    this.fallbackTimers.set(elicitId, timer);
  }

  /**
   * Get a pending elicitation fallback by elicit ID.
   * Returns null if not found or expired.
   */
  async getPendingFallback(elicitId: string): Promise<PendingElicitFallback | null> {
    const record = this.pendingFallback.get(elicitId);
    if (!record) {
      return null;
    }

    // Check if expired
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
    this.pendingFallback.delete(elicitId);

    const timer = this.fallbackTimers.get(elicitId);
    if (timer) {
      clearTimeout(timer);
      this.fallbackTimers.delete(elicitId);
    }
  }

  /**
   * Store a resolved elicit result for re-invocation.
   * Results are stored with a 300-second TTL to match Redis store behavior.
   */
  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>): Promise<void> {
    // Clear any existing timer for this elicitId
    const existingTimer = this.resolvedTimers.get(elicitId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.resolvedResults.set(elicitId, {
      elicitId,
      result,
      resolvedAt: Date.now(),
    });

    // Set up expiration timer (300 seconds = 5 minutes, matching Redis store)
    const timer = setTimeout(() => {
      this.resolvedResults.delete(elicitId);
      this.resolvedTimers.delete(elicitId);
    }, 300_000);

    this.resolvedTimers.set(elicitId, timer);
  }

  /**
   * Get a resolved elicit result by elicit ID.
   */
  async getResolvedResult(elicitId: string): Promise<ResolvedElicitResult | null> {
    return this.resolvedResults.get(elicitId) ?? null;
  }

  /**
   * Delete a resolved elicit result by elicit ID.
   */
  async deleteResolvedResult(elicitId: string): Promise<void> {
    this.resolvedResults.delete(elicitId);

    const timer = this.resolvedTimers.get(elicitId);
    if (timer) {
      clearTimeout(timer);
      this.resolvedTimers.delete(elicitId);
    }
  }
}
