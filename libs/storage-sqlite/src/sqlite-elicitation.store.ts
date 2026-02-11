/**
 * SQLite Elicitation Store
 *
 * Implements the ElicitationStore interface using SQLite KV store.
 * Uses Node.js EventEmitter for single-process pub/sub (replaces Redis pub/sub).
 * Suitable for local-only deployments (no distributed pub/sub needed).
 */

import { EventEmitter } from 'node:events';
import { SqliteKvStore } from './sqlite-kv.store';
import type { SqliteStorageOptions } from './sqlite.options';

/**
 * Pending elicitation record.
 * Matches PendingElicitRecord from @frontmcp/sdk.
 */
export interface PendingElicitRecord {
  elicitId: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  message: string;
  mode: string;
  requestedSchema?: Record<string, unknown>;
}

/**
 * Pending fallback record.
 * Matches PendingElicitFallback from @frontmcp/sdk.
 */
export type PendingElicitFallback = Record<string, unknown>;

/**
 * Elicit result type.
 */
export type ElicitResult<T = unknown> = {
  status: string;
  content?: T;
  [key: string]: unknown;
};

/**
 * Resolved elicit result stored for re-invocation.
 */
export type ResolvedElicitResult = Record<string, unknown>;

/**
 * Fallback execution result.
 */
export type FallbackExecutionResult = Record<string, unknown>;

export type ElicitResultCallback<T = unknown> = (result: ElicitResult<T>) => void;
export type FallbackResultCallback = (result: FallbackExecutionResult) => void;
export type ElicitUnsubscribe = () => Promise<void>;

export interface SqliteElicitationStoreOptions extends SqliteStorageOptions {
  /** Key prefix for elicitation keys. @default 'mcp:elicit:' */
  keyPrefix?: string;
}

/**
 * Elicitation store interface.
 * Matches ElicitationStore from @frontmcp/sdk.
 */
export interface ElicitationStoreInterface {
  setPending(record: PendingElicitRecord): Promise<void>;
  getPending(sessionId: string): Promise<PendingElicitRecord | null>;
  deletePending(sessionId: string): Promise<void>;
  subscribeResult<T = unknown>(
    elicitId: string,
    callback: ElicitResultCallback<T>,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe>;
  publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void>;
  destroy?(): Promise<void>;
  setPendingFallback(record: PendingElicitFallback): Promise<void>;
  getPendingFallback(elicitId: string, sessionId?: string): Promise<PendingElicitFallback | null>;
  deletePendingFallback(elicitId: string): Promise<void>;
  setResolvedResult(elicitId: string, result: ElicitResult<unknown>, sessionId?: string): Promise<void>;
  getResolvedResult(elicitId: string, sessionId?: string): Promise<ResolvedElicitResult | null>;
  deleteResolvedResult(elicitId: string): Promise<void>;
  subscribeFallbackResult(
    elicitId: string,
    callback: FallbackResultCallback,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe>;
  publishFallbackResult(elicitId: string, sessionId: string, result: FallbackExecutionResult): Promise<void>;
}

/**
 * SQLite-backed elicitation store with EventEmitter-based pub/sub.
 *
 * Storage layout:
 * - `pending:{sessionId}` - Pending elicitation records
 * - `fallback:{elicitId}` - Fallback context
 * - `resolved:{elicitId}` - Pre-resolved results
 *
 * Pub/sub channels (via EventEmitter):
 * - `result:{elicitId}` - Elicitation results
 * - `fallback-result:{elicitId}` - Fallback execution results
 */
export class SqliteElicitationStore implements ElicitationStoreInterface {
  private kv: SqliteKvStore;
  private emitter: EventEmitter;
  private keyPrefix: string;

  constructor(options: SqliteElicitationStoreOptions) {
    this.kv = new SqliteKvStore(options);
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
    this.keyPrefix = options.keyPrefix ?? 'mcp:elicit:';
  }

  private pendingKey(sessionId: string): string {
    return `${this.keyPrefix}pending:${sessionId}`;
  }

  private fallbackKey(elicitId: string): string {
    return `${this.keyPrefix}fallback:${elicitId}`;
  }

  private resolvedKey(elicitId: string): string {
    return `${this.keyPrefix}resolved:${elicitId}`;
  }

  private resultChannel(elicitId: string): string {
    return `result:${elicitId}`;
  }

  private fallbackResultChannel(elicitId: string): string {
    return `fallback-result:${elicitId}`;
  }

  async setPending(record: PendingElicitRecord): Promise<void> {
    const ttlMs = record.expiresAt - Date.now();
    if (ttlMs <= 0) return;
    this.kv.setJSON(this.pendingKey(record.sessionId), record, ttlMs);
  }

  async getPending(sessionId: string): Promise<PendingElicitRecord | null> {
    return this.kv.getJSON<PendingElicitRecord>(this.pendingKey(sessionId));
  }

  async deletePending(sessionId: string): Promise<void> {
    this.kv.del(this.pendingKey(sessionId));
  }

  async subscribeResult<T = unknown>(
    elicitId: string,
    callback: ElicitResultCallback<T>,
    _sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    const channel = this.resultChannel(elicitId);
    const handler = (result: ElicitResult<T>) => callback(result);
    this.emitter.on(channel, handler);

    return async () => {
      this.emitter.removeListener(channel, handler);
    };
  }

  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    // Clean up pending record
    this.kv.del(this.pendingKey(sessionId));
    // Emit result to subscribers
    this.emitter.emit(this.resultChannel(elicitId), result);
  }

  async setPendingFallback(record: PendingElicitFallback): Promise<void> {
    const elicitId = record['elicitId'] as string;
    if (!elicitId) return;
    // Default 5 minute TTL for fallbacks
    this.kv.setJSON(this.fallbackKey(elicitId), record, 300000);
  }

  async getPendingFallback(elicitId: string, _sessionId?: string): Promise<PendingElicitFallback | null> {
    return this.kv.getJSON<PendingElicitFallback>(this.fallbackKey(elicitId));
  }

  async deletePendingFallback(elicitId: string): Promise<void> {
    this.kv.del(this.fallbackKey(elicitId));
  }

  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>, _sessionId?: string): Promise<void> {
    // Default 5 minute TTL for resolved results
    this.kv.setJSON(this.resolvedKey(elicitId), result, 300000);
  }

  async getResolvedResult(elicitId: string, _sessionId?: string): Promise<ResolvedElicitResult | null> {
    return this.kv.getJSON<ResolvedElicitResult>(this.resolvedKey(elicitId));
  }

  async deleteResolvedResult(elicitId: string): Promise<void> {
    this.kv.del(this.resolvedKey(elicitId));
  }

  async subscribeFallbackResult(
    elicitId: string,
    callback: FallbackResultCallback,
    _sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    const channel = this.fallbackResultChannel(elicitId);
    const handler = (result: FallbackExecutionResult) => callback(result);
    this.emitter.on(channel, handler);

    return async () => {
      this.emitter.removeListener(channel, handler);
    };
  }

  async publishFallbackResult(elicitId: string, _sessionId: string, result: FallbackExecutionResult): Promise<void> {
    this.emitter.emit(this.fallbackResultChannel(elicitId), result);
  }

  async destroy(): Promise<void> {
    this.emitter.removeAllListeners();
    this.kv.close();
  }

  /**
   * Get the underlying KV store (for testing/advanced use).
   */
  getKvStore(): SqliteKvStore {
    return this.kv;
  }
}
