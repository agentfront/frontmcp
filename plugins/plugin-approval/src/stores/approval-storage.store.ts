/**
 * Storage-backed implementation of the ApprovalStore.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createMemoryStorage,
  createStorage,
  type NamespacedStorage,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import { approvalRecordSchema, ApprovalOperationError, normalizeGrantor } from '../approval';
import { assertValidTtl } from '../approval/policy';
import { ApprovalScope, ApprovalState, type ApprovalContext, type ApprovalRecord } from '../types';
import type {
  ApprovalQuery,
  ApprovalStore,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escape glob metacharacters in a string for safe pattern matching.
 * Redis/storage SCAN patterns use glob-style matching where *, ?, and [ are special.
 */
function escapePattern(str: string): string {
  return str.replace(/[*?[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for ApprovalStorageStore.
 */
export interface ApprovalStorageStoreOptions {
  /**
   * Storage configuration. If not provided, uses auto-detection.
   * @default { type: 'auto' }
   */
  storage?: StorageConfig;

  /**
   * Use an existing storage instance instead of creating a new one.
   */
  storageInstance?: RootStorage | NamespacedStorage;

  /**
   * Namespace prefix for approval keys.
   * @default 'approval'
   */
  namespace?: string;

  /**
   * Cleanup interval for expired approvals (in seconds).
   * Set to 0 to disable automatic cleanup.
   * @default 60
   */
  cleanupIntervalSeconds?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalStorageStore Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Storage-backed implementation of the ApprovalStore.
 * Works with any storage backend (memory, Redis, Vercel KV, Upstash).
 */
@Provider({
  name: 'provider:approval:store:storage',
  description: 'Storage-backed approval store (supports Memory, Redis, Vercel KV, Upstash)',
  scope: ProviderScope.GLOBAL,
})
export class ApprovalStorageStore implements ApprovalStore {
  private storage!: NamespacedStorage;
  private readonly options: Required<Omit<ApprovalStorageStoreOptions, 'storageInstance'>> & {
    storageInstance?: RootStorage | NamespacedStorage;
  };
  private cleanupInterval?: NodeJS.Timeout;
  private initialized = false;
  private ownedStorage = false;

  constructor(options: ApprovalStorageStoreOptions = {}) {
    this.options = {
      storage: options.storage ?? { type: 'auto' },
      storageInstance: options.storageInstance,
      namespace: options.namespace ?? 'approval',
      cleanupIntervalSeconds: options.cleanupIntervalSeconds ?? 60,
    };
  }

  /**
   * Initialize the storage connection.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.options.storageInstance) {
      this.storage = this.options.storageInstance.namespace(this.options.namespace);
      this.ownedStorage = false;
    } else {
      const rootStorage = await createStorage(this.options.storage);
      this.storage = rootStorage.namespace(this.options.namespace);
      this.ownedStorage = true;
    }

    if (this.options.cleanupIntervalSeconds > 0) {
      this.cleanupInterval = setInterval(() => {
        void this.clearExpiredApprovals();
      }, this.options.cleanupIntervalSeconds * 1000);
      (this.cleanupInterval as { unref?: () => void }).unref?.();
    }

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ApprovalStorageStore not initialized. Call initialize() first.');
    }
  }

  private buildKey(toolId: string, sessionId?: string, userId?: string, context?: ApprovalContext): string {
    const parts = [toolId];
    if (sessionId) parts.push(`session:${sessionId}`);
    if (userId) parts.push(`user:${userId}`);
    if (context) parts.push(`ctx:${context.type}:${context.identifier}`);
    return parts.join(':');
  }

  private parseRecord(value: string | null): ApprovalRecord | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      const result = approvalRecordSchema.safeParse(parsed);
      if (!result.success) {
        return undefined;
      }
      return result.data as ApprovalRecord;
    } catch {
      return undefined;
    }
  }

  private isExpired(approval: ApprovalRecord): boolean {
    return approval.expiresAt !== undefined && Date.now() > approval.expiresAt;
  }

  /**
   * The keys a caller's approvals of a tool can be stored under: its session, its user, both
   * (time-limited and context grants made through `ApprovalService`), and, for a call in a
   * server-established context, that context.
   */
  private callerKeys(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): string[] {
    const keys = [this.buildKey(toolId, sessionId)];
    if (userId) {
      keys.push(this.buildKey(toolId, undefined, userId), this.buildKey(toolId, sessionId, userId));
    }
    if (context) {
      keys.push(this.buildKey(toolId, sessionId, userId, context));
    }
    return [...new Set(keys)];
  }

  /**
   * Every unexpired record that applies to this caller: session, user, time-limited and, when
   * `context` is given, context-specific approvals and denials.
   */
  async getApprovals(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const records: ApprovalRecord[] = [];
    for (const key of this.callerKeys(toolId, sessionId, userId, context)) {
      const record = this.parseRecord(await this.storage.get(key));
      if (record && record.toolId === toolId && !this.isExpired(record)) {
        records.push(record);
      }
    }
    return records;
  }

  /**
   * The caller's record for a tool; a denial in any of its scopes wins, so an approval in one
   * scope cannot mask a denial in another.
   */
  async getApproval(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord | undefined> {
    const records = await this.getApprovals(toolId, sessionId, userId, context);
    return records.find((record) => record.state === ApprovalState.DENIED) ?? records[0];
  }

  async queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const results: ApprovalRecord[] = [];
    const pattern = query.toolId ? `${escapePattern(query.toolId)}:*` : '*';
    const keys = await this.storage.keys(pattern);
    const values = await this.storage.mget(keys);

    for (const value of values) {
      const approval = this.parseRecord(value);
      if (!approval) continue;

      if (!query.includeExpired && this.isExpired(approval)) {
        continue;
      }

      if (query.toolId && approval.toolId !== query.toolId) continue;
      if (query.toolIds && !query.toolIds.includes(approval.toolId)) continue;
      if (query.scope && approval.scope !== query.scope) continue;
      if (query.scopes && !query.scopes.includes(approval.scope)) continue;
      if (query.state && approval.state !== query.state) continue;
      if (query.states && !query.states.includes(approval.state)) continue;
      if (query.sessionId && approval.sessionId !== query.sessionId) continue;
      if (query.userId && approval.userId !== query.userId) continue;
      if (query.context) {
        if (
          !approval.context ||
          approval.context.type !== query.context.type ||
          approval.context.identifier !== query.context.identifier
        ) {
          continue;
        }
      }

      results.push(approval);
    }

    return results;
  }

  async grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord> {
    this.ensureInitialized();

    assertValidTtl(options.ttlMs);
    if (options.scope === ApprovalScope.TIME_LIMITED && options.ttlMs === undefined) {
      throw new ApprovalOperationError('grant', 'a time-limited approval needs ttlMs');
    }

    const now = Date.now();
    const expiresAt = options.ttlMs !== undefined ? now + options.ttlMs : undefined;
    const grantedBy = normalizeGrantor(options.grantedBy);

    const record: ApprovalRecord = {
      toolId: options.toolId,
      state: ApprovalState.APPROVED,
      scope: options.scope,
      grantedAt: now,
      expiresAt,
      ttlMs: options.ttlMs,
      sessionId: options.sessionId,
      userId: options.userId,
      context: options.context,
      grantedBy,
      reason: options.reason,
      metadata: options.metadata,
    };

    const key = this.buildKey(options.toolId, options.sessionId, options.userId, options.context);
    const ttlSeconds = options.ttlMs !== undefined ? Math.ceil(options.ttlMs / 1000) : undefined;
    await this.storage.set(key, JSON.stringify(record), { ttlSeconds });

    return record;
  }

  /**
   * Deletes the approvals of a tool that belong to the given session or user: with a context, only
   * that context's approval; otherwise every approval of the tool stored for that session or user
   * (session, user, time-limited and context approvals alike). Recorded denials are kept.
   */
  async revokeApproval(options: RevokeApprovalOptions): Promise<boolean> {
    this.ensureInitialized();

    const { toolId, sessionId, userId, context } = options;
    if (!sessionId && !userId && !context) {
      return false;
    }

    const keys = await this.storage.keys(`${escapePattern(toolId)}:*`);
    const values = await this.storage.mget(keys);
    const keysToDelete: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const record = this.parseRecord(values[i]);
      if (!record || record.toolId !== toolId || record.state === ApprovalState.DENIED) continue;
      if (context) {
        if (
          record.context?.type === context.type &&
          record.context.identifier === context.identifier &&
          (!sessionId || record.sessionId === sessionId) &&
          (!userId || record.userId === userId)
        ) {
          keysToDelete.push(keys[i]);
        }
        continue;
      }
      if ((sessionId && record.sessionId === sessionId) || (userId && record.userId === userId)) {
        keysToDelete.push(keys[i]);
      }
    }

    if (keysToDelete.length === 0) {
      return false;
    }
    await this.storage.mdelete(keysToDelete);
    return true;
  }

  async isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean> {
    const approval = await this.getApproval(toolId, sessionId, userId, context);
    return approval?.state === ApprovalState.APPROVED;
  }

  async clearSessionApprovals(sessionId: string): Promise<number> {
    this.ensureInitialized();

    // Escape sessionId to prevent glob metacharacters from matching unintended keys, and match the
    // id exactly: `session:${id}` at the end of the key or followed by `:`, never a longer id.
    const escapedSessionId = escapePattern(sessionId);
    const keys = [
      ...new Set([
        ...(await this.storage.keys(`*:session:${escapedSessionId}`)),
        ...(await this.storage.keys(`*:session:${escapedSessionId}:*`)),
      ]),
    ];

    if (keys.length === 0) {
      return 0;
    }

    return await this.storage.mdelete(keys);
  }

  async clearExpiredApprovals(): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    const keys = await this.storage.keys('*');
    const values = await this.storage.mget(keys);

    const keysToDelete: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      const approval = this.parseRecord(values[i]);
      if (approval && approval.expiresAt && approval.expiresAt <= now) {
        keysToDelete.push(keys[i]);
      }
    }

    if (keysToDelete.length > 0) {
      return await this.storage.mdelete(keysToDelete);
    }

    return 0;
  }

  async getStats(): Promise<{
    totalApprovals: number;
    byScope: Record<ApprovalScope, number>;
    byState: Record<ApprovalState, number>;
  }> {
    this.ensureInitialized();

    const byScope: Record<ApprovalScope, number> = {
      [ApprovalScope.SESSION]: 0,
      [ApprovalScope.USER]: 0,
      [ApprovalScope.TIME_LIMITED]: 0,
      [ApprovalScope.TOOL_SPECIFIC]: 0,
      [ApprovalScope.CONTEXT_SPECIFIC]: 0,
    };

    const byState: Record<ApprovalState, number> = {
      [ApprovalState.PENDING]: 0,
      [ApprovalState.APPROVED]: 0,
      [ApprovalState.DENIED]: 0,
      [ApprovalState.EXPIRED]: 0,
    };

    const keys = await this.storage.keys('*');
    const values = await this.storage.mget(keys);

    let total = 0;
    for (const value of values) {
      const approval = this.parseRecord(value);
      if (approval) {
        total++;
        byScope[approval.scope]++;
        byState[approval.state]++;
      }
    }

    return {
      totalApprovals: total,
      byScope,
      byState,
    };
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    if (this.ownedStorage && this.storage) {
      await this.storage.root.disconnect();
    }

    this.initialized = false;
  }
}

/**
 * Create an ApprovalStorageStore with synchronous memory storage.
 */
export function createApprovalMemoryStore(
  options: Omit<ApprovalStorageStoreOptions, 'storage' | 'storageInstance'> = {},
): ApprovalStorageStore {
  const memoryStorage = createMemoryStorage();
  return new ApprovalStorageStore({
    ...options,
    storageInstance: memoryStorage,
  });
}
