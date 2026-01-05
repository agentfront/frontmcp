import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createStorage,
  createMemoryStorage,
  type RootStorage,
  type NamespacedStorage,
  type StorageConfig,
} from '@frontmcp/utils';
import type {
  ApprovalStore,
  ApprovalQuery,
  GrantApprovalOptions,
  RevokeApprovalOptions,
} from './approval-store.interface';
import type {
  ApprovalRecord,
  ApprovalContext,
  ApprovalGrantor,
  ApprovalRevoker,
  ApprovalSourceType,
  RevocationSourceType,
} from './approval.types';
import { ApprovalScope, ApprovalState } from './approval.types';

// ─────────────────────────────────────────────────────────────────────────────
// Normalization Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a grantedBy input to the structured ApprovalGrantor format.
 * Accepts either a simple string source type or a full ApprovalGrantor object.
 */
function normalizeGrantor(input: ApprovalGrantor | ApprovalSourceType | undefined): ApprovalGrantor {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
}

/**
 * Normalize a revokedBy input to the structured ApprovalRevoker format.
 * Accepts either a simple string source type or a full ApprovalRevoker object.
 */
function normalizeRevoker(input: ApprovalRevoker | RevocationSourceType | undefined): ApprovalRevoker {
  if (!input) {
    return { source: 'user' };
  }
  if (typeof input === 'string') {
    return { source: input };
  }
  return input;
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
   * Takes precedence over `storage` config.
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
 *
 * @example Memory storage (development)
 * ```typescript
 * const store = new ApprovalStorageStore();
 * await store.initialize();
 * ```
 *
 * @example Redis storage (production)
 * ```typescript
 * const store = new ApprovalStorageStore({
 *   storage: { type: 'redis', redis: { url: 'redis://localhost:6379' } }
 * });
 * await store.initialize();
 * ```
 *
 * @example With existing storage instance
 * ```typescript
 * const rootStorage = await createStorage({ type: 'redis' });
 * const store = new ApprovalStorageStore({
 *   storageInstance: rootStorage.namespace('myapp')
 * });
 * await store.initialize();
 * ```
 */
@Provider({
  name: 'provider:remember:approval-store:storage',
  description: 'Storage-backed approval store for RememberPlugin (supports Memory, Redis, Vercel KV, Upstash)',
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
   * Must be called before using the store.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Use provided storage instance or create new one
    if (this.options.storageInstance) {
      this.storage = this.options.storageInstance.namespace(this.options.namespace);
      this.ownedStorage = false;
    } else {
      const rootStorage = await createStorage(this.options.storage);
      this.storage = rootStorage.namespace(this.options.namespace);
      this.ownedStorage = true;
    }

    // Start cleanup interval if enabled
    if (this.options.cleanupIntervalSeconds > 0) {
      this.cleanupInterval = setInterval(() => {
        void this.clearExpiredApprovals();
      }, this.options.cleanupIntervalSeconds * 1000);
      (this.cleanupInterval as { unref?: () => void }).unref?.();
    }

    this.initialized = true;
  }

  /**
   * Ensure initialization before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ApprovalStorageStore not initialized. Call initialize() first.');
    }
  }

  /**
   * Build a unique key for an approval.
   */
  private buildKey(toolId: string, sessionId?: string, userId?: string, context?: ApprovalContext): string {
    const parts = [toolId];
    if (sessionId) parts.push(`session:${sessionId}`);
    if (userId) parts.push(`user:${userId}`);
    if (context) parts.push(`ctx:${context.type}:${context.identifier}`);
    return parts.join(':');
  }

  /**
   * Parse an approval record from storage.
   */
  private parseRecord(value: string | null): ApprovalRecord | undefined {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as ApprovalRecord;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if an approval is expired.
   */
  private isExpired(approval: ApprovalRecord): boolean {
    return approval.expiresAt !== undefined && Date.now() > approval.expiresAt;
  }

  /**
   * Get approval for a specific tool.
   */
  async getApproval(toolId: string, sessionId: string, userId?: string): Promise<ApprovalRecord | undefined> {
    this.ensureInitialized();

    // Check session approval first
    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionValue = await this.storage.get(sessionKey);
    const sessionApproval = this.parseRecord(sessionValue);
    if (sessionApproval && !this.isExpired(sessionApproval)) {
      return sessionApproval;
    }

    // Check user approval
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

  /**
   * Query approvals matching filters.
   */
  async queryApprovals(query: ApprovalQuery): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const results: ApprovalRecord[] = [];

    // Get all keys matching pattern
    const pattern = query.toolId ? `${query.toolId}:*` : '*';
    const keys = await this.storage.keys(pattern);

    // Batch fetch all values
    const values = await this.storage.mget(keys);

    for (const value of values) {
      const approval = this.parseRecord(value);
      if (!approval) continue;

      // Check expiration
      if (!query.includeExpired && this.isExpired(approval)) {
        continue;
      }

      // Apply filters
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

  /**
   * Grant approval for a tool.
   */
  async grantApproval(options: GrantApprovalOptions): Promise<ApprovalRecord> {
    this.ensureInitialized();

    const now = Date.now();
    const expiresAt = options.ttlMs ? now + options.ttlMs : undefined;

    // Normalize grantedBy to full ApprovalGrantor structure
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

    // Store with TTL if specified (convert ms to seconds)
    const ttlSeconds = options.ttlMs ? Math.ceil(options.ttlMs / 1000) : undefined;
    await this.storage.set(key, JSON.stringify(record), { ttlSeconds });

    return record;
  }

  /**
   * Revoke approval for a tool.
   */
  async revokeApproval(options: RevokeApprovalOptions): Promise<boolean> {
    this.ensureInitialized();

    const key = this.buildKey(options.toolId, options.sessionId, options.userId, options.context);

    const exists = await this.storage.exists(key);
    if (exists) {
      // Delete the record
      await this.storage.delete(key);
      return true;
    }

    return false;
  }

  /**
   * Check if a tool is approved.
   */
  async isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean> {
    this.ensureInitialized();

    // Check context-specific approval first
    if (context) {
      const contextKey = this.buildKey(toolId, sessionId, userId, context);
      const contextValue = await this.storage.get(contextKey);
      const contextApproval = this.parseRecord(contextValue);
      if (contextApproval && contextApproval.state === ApprovalState.APPROVED && !this.isExpired(contextApproval)) {
        return true;
      }
    }

    // Check session approval
    const sessionKey = this.buildKey(toolId, sessionId);
    const sessionValue = await this.storage.get(sessionKey);
    const sessionApproval = this.parseRecord(sessionValue);
    if (sessionApproval && sessionApproval.state === ApprovalState.APPROVED && !this.isExpired(sessionApproval)) {
      return true;
    }

    // Check user approval
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

  /**
   * Clear all session approvals.
   */
  async clearSessionApprovals(sessionId: string): Promise<number> {
    this.ensureInitialized();

    // Find all keys for this session
    const pattern = `*:session:${sessionId}*`;
    const keys = await this.storage.keys(pattern);

    if (keys.length === 0) {
      return 0;
    }

    return await this.storage.mdelete(keys);
  }

  /**
   * Clear expired approvals.
   */
  async clearExpiredApprovals(): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    let count = 0;

    // Get all keys
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
      count = await this.storage.mdelete(keysToDelete);
    }

    return count;
  }

  /**
   * Get approval statistics.
   */
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

    // Get all keys and values
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

  /**
   * Close the store and cleanup.
   */
  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Only disconnect if we own the storage
    if (this.ownedStorage && this.storage) {
      await this.storage.root.disconnect();
    }

    this.initialized = false;
  }
}

/**
 * Create an ApprovalStorageStore with synchronous memory storage.
 * Convenience function for simple use cases.
 *
 * @example
 * ```typescript
 * const store = createApprovalMemoryStore();
 * // No need to call initialize() - storage is already connected
 * ```
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
