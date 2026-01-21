/**
 * Elicitation Store Interface
 *
 * Abstraction for storing and routing elicitation state across distributed systems.
 * Supports storage backends with pub/sub for multi-node deployments and in-memory fallback for
 * single-node/development environments.
 *
 * Key design decisions:
 * - Pending records are keyed by sessionId (only one elicit per session allowed)
 * - Pub/sub channels are keyed by elicitId (for result routing)
 * - This separation allows form mode (lookup by session) and URL mode (direct elicitId)
 */

import {
  ElicitResult,
  ElicitMode,
  PendingElicitFallback,
  ResolvedElicitResult,
  FallbackExecutionResult,
  FallbackResultCallback,
} from '../elicitation.types';

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

  /** JSON Schema for validating result content (optional for backward compat) */
  requestedSchema?: Record<string, unknown>;
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
 *   await store.publishResult(pending.elicitId, pending.sessionId, { status: 'accept', content: { confirmed: true } });
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
   * @param sessionId - Optional session ID for encrypted stores (required for decryption)
   * @returns Unsubscribe function to clean up the subscription
   */
  subscribeResult<T = unknown>(
    elicitId: string,
    callback: ElicitResultCallback<T>,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe>;

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

  // ============================================
  // Fallback Elicitation Methods
  // ============================================
  // Used for clients that don't support the standard elicitation protocol.
  // These methods store context for re-invoking tools via sendElicitationResult.

  /**
   * Store a pending elicitation fallback context.
   * Keyed by elicitId since we need to look up by elicitId when
   * sendElicitationResult is called.
   *
   * @param record - The pending fallback record to store
   */
  setPendingFallback(record: PendingElicitFallback): Promise<void>;

  /**
   * Get a pending elicitation fallback by elicit ID.
   *
   * @param elicitId - The elicitation ID to look up
   * @param sessionId - Optional session ID for encrypted stores (required for decryption)
   * @returns The pending fallback record, or null if not found or expired
   */
  getPendingFallback(elicitId: string, sessionId?: string): Promise<PendingElicitFallback | null>;

  /**
   * Delete a pending elicitation fallback by elicit ID.
   *
   * @param elicitId - The elicitation ID to delete
   */
  deletePendingFallback(elicitId: string): Promise<void>;

  /**
   * Store a resolved elicit result for re-invocation.
   * Used to pass the result to the tool when it's re-invoked.
   *
   * @param elicitId - The elicitation ID
   * @param result - The elicitation result from the user
   * @param sessionId - Optional session ID for encrypted stores (required for encryption)
   */
  setResolvedResult(elicitId: string, result: ElicitResult<unknown>, sessionId?: string): Promise<void>;

  /**
   * Get a resolved elicit result by elicit ID.
   *
   * @param elicitId - The elicitation ID to look up
   * @param sessionId - Optional session ID for encrypted stores (required for decryption)
   * @returns The resolved result, or null if not found
   */
  getResolvedResult(elicitId: string, sessionId?: string): Promise<ResolvedElicitResult | null>;

  /**
   * Delete a resolved elicit result by elicit ID.
   *
   * @param elicitId - The elicitation ID to delete
   */
  deleteResolvedResult(elicitId: string): Promise<void>;

  // ============================================
  // Waiting Fallback Pub/Sub Methods
  // ============================================
  // Used for distributed routing of fallback results.
  // When the original tool call waits for the result, and
  // sendElicitationResult arrives on a different node,
  // pub/sub routes the result back to the waiting request.

  /**
   * Subscribe to fallback execution results for a specific elicit ID.
   * In distributed mode, this creates a Redis pub/sub subscription
   * for the channel `fallback-result:{elicitId}`.
   *
   * @param elicitId - The elicitation ID to subscribe to
   * @param callback - Called when a fallback result is published for this elicit ID
   * @param sessionId - Optional session ID for encrypted stores (required for decryption)
   * @returns Unsubscribe function to clean up the subscription
   */
  subscribeFallbackResult(
    elicitId: string,
    callback: FallbackResultCallback,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe>;

  /**
   * Publish a fallback execution result.
   * In distributed mode, this publishes via Redis pub/sub to reach the
   * waiting node that originated the elicitation request.
   *
   * @param elicitId - The elicitation ID
   * @param sessionId - The session ID (for encryption)
   * @param result - The fallback execution result to publish
   */
  publishFallbackResult(elicitId: string, sessionId: string, result: FallbackExecutionResult): Promise<void>;
}
