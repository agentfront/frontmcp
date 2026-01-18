/**
 * Elicitation Store Interface
 *
 * Abstraction for storing and routing elicitation state across distributed systems.
 * Supports Redis pub/sub for multi-node deployments and in-memory fallback for
 * single-node/development environments.
 *
 * Key design decisions:
 * - Pending records are keyed by sessionId (only one elicit per session allowed)
 * - Pub/sub channels are keyed by elicitId (for result routing)
 * - This separation allows form mode (lookup by session) and URL mode (direct elicitId)
 */

import { ElicitResult, ElicitMode } from './elicitation.types';

/**
 * Record stored for each pending elicitation.
 * Keyed by sessionId since only one pending elicit per session is allowed.
 */
export interface PendingElicitRecord {
  /** Unique identifier for this elicit request (used for pub/sub routing) */
  elicitId: string;

  /** Session ID that initiated the elicitation (used as storage key) */
  sessionId: string;

  /** Timestamp when the elicitation was created */
  createdAt: number;

  /** Absolute timestamp when the elicitation expires */
  expiresAt: number;

  /** Message displayed to the user */
  message: string;

  /** Elicitation mode (form or url) */
  mode: ElicitMode;
}

/**
 * Callback type for elicitation result subscriptions.
 */
export type ElicitResultCallback<T = unknown> = (result: ElicitResult<T>) => void;

/**
 * Unsubscribe function returned by subscribeResult.
 */
export type ElicitUnsubscribe = () => Promise<void>;

/**
 * Elicitation store interface.
 *
 * Provides storage and pub/sub for elicitation state. In distributed deployments,
 * this enables routing elicitation responses to the correct node via Redis pub/sub.
 *
 * Storage is keyed by sessionId (only one pending elicit per session).
 * Pub/sub is keyed by elicitId (for cross-node result routing).
 *
 * @example
 * ```typescript
 * // Store pending elicitation (keyed by sessionId)
 * await store.setPending({
 *   elicitId: 'elicit-123',
 *   sessionId: 'session-abc',
 *   createdAt: Date.now(),
 *   expiresAt: Date.now() + 300000,
 *   message: 'Confirm action?',
 *   mode: 'form',
 * });
 *
 * // Subscribe to results by elicitId (on the node that sent the elicit)
 * const unsubscribe = await store.subscribeResult('elicit-123', (result) => {
 *   console.log('Got result:', result);
 * });
 *
 * // On any node: lookup by sessionId, then publish result by elicitId
 * const pending = await store.getPending('session-abc');
 * if (pending) {
 *   await store.publishResult(pending.elicitId, { status: 'accept', content: { confirmed: true } });
 * }
 * ```
 */
export interface ElicitationStore {
  /**
   * Store a pending elicitation with TTL.
   * The record is keyed by sessionId and will auto-expire based on `expiresAt`.
   *
   * @param record - The pending elicitation record to store
   */
  setPending(record: PendingElicitRecord): Promise<void>;

  /**
   * Get a pending elicitation by session ID.
   * Since only one elicit per session is allowed, sessionId is the lookup key.
   *
   * @param sessionId - The session ID to look up
   * @returns The pending record, or null if not found or expired
   */
  getPending(sessionId: string): Promise<PendingElicitRecord | null>;

  /**
   * Delete a pending elicitation by session ID.
   * Called after the elicitation is resolved or times out.
   *
   * @param sessionId - The session ID to delete
   */
  deletePending(sessionId: string): Promise<void>;

  /**
   * Subscribe to elicitation results for a specific elicit ID.
   * In distributed mode, this creates a Redis pub/sub subscription.
   *
   * @param elicitId - The elicitation ID to subscribe to
   * @param callback - Called when a result is published for this elicit ID
   * @returns Unsubscribe function to clean up the subscription
   */
  subscribeResult<T = unknown>(elicitId: string, callback: ElicitResultCallback<T>): Promise<ElicitUnsubscribe>;

  /**
   * Publish an elicitation result.
   * In distributed mode, this publishes via Redis pub/sub to reach the
   * correct node regardless of which node received the client response.
   * Also cleans up the pending record.
   *
   * @param elicitId - The elicitation ID
   * @param sessionId - The session ID (for cleanup)
   * @param result - The elicitation result to publish
   */
  publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void>;

  /**
   * Clean up store resources.
   * Called during server shutdown.
   */
  destroy?(): Promise<void>;
}
