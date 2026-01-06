/**
 * Storage-backed implementation of the ApprovalStore.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createStorage,
  createMemoryStorage,
  type RootStorage,
  type NamespacedStorage,
  type StorageConfig,
} from '@frontmcp/utils';
import { normalizeGrantor, normalizeRevoker } from '../approval';
import type {
  ApprovalStore,
  ApprovalQuery,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';
import { ApprovalScope, ApprovalState, type ApprovalRecord, type ApprovalContext } from '../types';

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
      return JSON.parse(value) as ApprovalRecord;
    } catch {
      return undefined;
    }
  }

  private isExpired(approval: ApprovalRecord): boolean {
    return approval.expiresAt !== undefined && Date.now() > approval.expiresAt;
  }

  async getApproval(toolId: string, sessionId: string, userId?: string): Promise<ApprovalRecord | undefined> {
    this.ensureInitialized();

    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionValue = await this.storage.get(sessionKey);
    const sessionApproval = this.parseRecord(sessionValue);
    if (sessionApproval && !this.isExpired(sessionApproval)) {
      return sessionApproval;
    }

    if (userId) {
      const userKey = this.buildKey(toolId, undefined, userId);
      const userValue = await this.storage.get(userKey);
      const userApproval = this.parseRecord(userValue);
      if (userApproval && !this.isExpired(userApproval)) {
        return userApproval;
      }
    }

    return undefined;
  }

  async queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const results: ApprovalRecord[] = [];
    const pattern = query.toolId ? `${query.toolId}:*` : '*';
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

    const now = Date.now();
    const expiresAt = options.ttlMs ? now + options.ttlMs : undefined;
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
    const ttlSeconds = options.ttlMs ? Math.ceil(options.ttlMs / 1000) : undefined;
    await this.storage.set(key, JSON.stringify(record), { ttlSeconds });

    return record;
  }

  async revokeApproval(options: RevokeApprovalOptions): Promise<boolean> {
    this.ensureInitialized();

    const key = this.buildKey(options.toolId, options.sessionId, options.userId, options.context);
    const exists = await this.storage.exists(key);
    if (exists) {
      await this.storage.delete(key);
      return true;
    }

    return false;
  }

  async isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean> {
    this.ensureInitialized();

    if (context) {
      const contextKey = this.buildKey(toolId, sessionId, userId, context);
      const contextValue = await this.storage.get(contextKey);
      const contextApproval = this.parseRecord(contextValue);
      if (contextApproval && contextApproval.state === ApprovalState.APPROVED && !this.isExpired(contextApproval)) {
        return true;
      }
    }

    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionValue = await this.storage.get(sessionKey);
    const sessionApproval = this.parseRecord(sessionValue);
    if (sessionApproval && sessionApproval.state === ApprovalState.APPROVED && !this.isExpired(sessionApproval)) {
      return true;
    }

    if (userId) {
      const userKey = this.buildKey(toolId, undefined, userId);
      const userValue = await this.storage.get(userKey);
      const userApproval = this.parseRecord(userValue);
      if (userApproval && userApproval.state === ApprovalState.APPROVED && !this.isExpired(userApproval)) {
        return true;
      }
    }

    return false;
  }

  async clearSessionApprovals(sessionId: string): Promise<number> {
    this.ensureInitialized();

    const pattern = `*:session:${sessionId}*`;
    const keys = await this.storage.keys(pattern);

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
