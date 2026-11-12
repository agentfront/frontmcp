/**
 * Storage-backed implementation of the ApprovalStore.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createMemoryStorage,
  createNamespacedStorage,
  createStorage,
  StorageNotSupportedError,
  type NamespacedStorage,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import {
  ApprovalConfigurationError,
  ApprovalOperationError,
  approvalRecordSchema,
  normalizeGrantor,
  normalizeRevoker,
} from '../approval';
import { grantorDelegationProblem } from '../approval/delegation';
import { assertValidTtl } from '../approval/policy';
import { auditFieldsOf, type ApprovalAuditSink } from '../audit/approval-audit';
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

/** Whether two records are the same grant (or denial) of the same tool to the same caller. */
function isSameRecord(a: ApprovalRecord, b: ApprovalRecord): boolean {
  return (
    a.toolId === b.toolId &&
    a.state === b.state &&
    a.scope === b.scope &&
    a.grantedAt === b.grantedAt &&
    a.sessionId === b.sessionId &&
    a.userId === b.userId &&
    a.context?.type === b.context?.type &&
    a.context?.identifier === b.context?.identifier
  );
}

/** How long a revocation stays readable through `getRevocations()`. */
const REVOCATION_RETENTION_SECONDS = 24 * 60 * 60;

/** Why an `alwaysPrompt` tool's approval cannot be used up on a backend without compare-and-delete. */
const SINGLE_USE_STORAGE_MESSAGE =
  "ApprovalPlugin: an alwaysPrompt tool's approval can be used up by exactly one call only on a storage that deletes " +
  "a key only while it holds a given value, and this storage cannot. Set the plugin's storage to type 'memory', " +
  "'redis', 'upstash', 'vercel-kv' or 'sqlite'.";

/** Suffix of the key of a time-limited approval granted without a context. */
const TIME_LIMITED_KEY_SEGMENT = `scope:${ApprovalScope.TIME_LIMITED}`;

/** The session, user and context a key is built for, and whether it holds a time-limited approval. */
interface KeyOwner {
  sessionId?: string;
  userId?: string;
  context?: ApprovalContext;
  timeLimited?: boolean;
}

/** A key and the owner a record read from it must name. */
interface OwnedKey {
  key: string;
  owner: KeyOwner;
}

/** An id as a key stores it: `%` and `:` percent-encoded, so no id can end its part of the key early. */
function encodeKeyPart(part: string): string {
  return part.replace(/%/g, '%25').replace(/:/g, '%3A');
}

/** An id as keys stored it up to 1.12.0, unencoded. */
function legacyKeyPart(part: string): string {
  return part;
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

  /**
   * The deepest delegation chain a delegated approval may name (`grantedBy.delegationContext`): a grant with a deeper
   * or broken chain is refused, and a stored one is not returned. Denials are kept whatever their chain.
   * @default 3
   */
  maxDelegationDepth?: number;

  /** Receives an event for each approval or denial recorded, revoked or expired. */
  audit?: ApprovalAuditSink;
}

/** The deepest delegation chain a delegated approval may name when `maxDelegationDepth` is not set. */
export const DEFAULT_MAX_DELEGATION_DEPTH = 3;

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
  /** Revoked approvals live beside the live ones, in a namespace no live-approval query scans. */
  private revocationStorage?: NamespacedStorage;
  private readonly options: Required<Omit<ApprovalStorageStoreOptions, 'storageInstance' | 'audit'>> & {
    storageInstance?: RootStorage | NamespacedStorage;
    audit?: ApprovalAuditSink;
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
      maxDelegationDepth: options.maxDelegationDepth ?? DEFAULT_MAX_DELEGATION_DEPTH,
      audit: options.audit,
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

  private get revocations(): NamespacedStorage {
    this.revocationStorage ??= createNamespacedStorage(
      this.storage.root,
      `${this.storage.prefix.replace(/:$/, '')}-revoked`,
    );
    return this.revocationStorage;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ApprovalStorageStore not initialized. Call initialize() first.');
    }
  }

  /**
   * The key of `owner`'s record of a tool. Ids are encoded, so an id holding `:` cannot spell another
   * owner's key; an id with neither `:` nor `%` is stored as it always was.
   */
  private buildKey(toolId: string, owner: KeyOwner, encode = encodeKeyPart): string {
    const parts = [toolId];
    if (owner.sessionId) parts.push(`session:${encode(owner.sessionId)}`);
    if (owner.userId) parts.push(`user:${encode(owner.userId)}`);
    if (owner.context) parts.push(`ctx:${encode(owner.context.type)}:${encode(owner.context.identifier)}`);
    if (owner.timeLimited) parts.push(TIME_LIMITED_KEY_SEGMENT);
    return parts.join(':');
  }

  /**
   * The key a new record is stored under. A time-limited approval without a context has a key of its
   * own, so it never replaces the session or user record, or a denial recorded there.
   */
  private recordKey(options: GrantApprovalOptions): string {
    const { toolId, scope, sessionId, userId, context } = options;
    return this.buildKey(toolId, {
      sessionId,
      userId,
      context,
      timeLimited: scope === ApprovalScope.TIME_LIMITED && !context,
    });
  }

  /** Whether `record` names exactly the session, user and context of `owner`, the owner of the key it was read from. */
  private isOwnedBy(record: ApprovalRecord, owner: KeyOwner): boolean {
    const { sessionId, userId, context } = record;
    return (
      this.buildKey(record.toolId, { sessionId, userId, context }) ===
      this.buildKey(record.toolId, { sessionId: owner.sessionId, userId: owner.userId, context: owner.context })
    );
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

  /** An approval whose delegation chain `maxDelegationDepth` refuses: deeper than it allows, or broken. */
  private isOverDelegated(record: ApprovalRecord): boolean {
    return (
      record.state === ApprovalState.APPROVED &&
      grantorDelegationProblem(record.grantedBy, this.options.maxDelegationDepth) !== undefined
    );
  }

  /**
   * The owners of the records that apply to a caller: its session, its user, both (an external
   * denial, and time-limited and context grants made through `ApprovalService`), the time-limited
   * records of each, and, for a call in a server-established context, that context (granted to the
   * session and the user, or to the session before it had a user, the way a session approval stays
   * in force once the caller's user is known).
   */
  private callerOwners(sessionId: string, userId?: string, context?: ApprovalContext): KeyOwner[] {
    const owners: KeyOwner[] = [{ sessionId }, { sessionId, timeLimited: true }];
    if (userId) {
      owners.push(
        { userId },
        { userId, timeLimited: true },
        { sessionId, userId },
        { sessionId, userId, timeLimited: true },
      );
    }
    if (context) {
      owners.push({ sessionId, context });
      if (userId) owners.push({ sessionId, userId, context });
    }
    return owners;
  }

  /**
   * The keys a caller's records of a tool can be stored under, each with the owner a record read
   * from it must name. Keys written up to 1.12.0, with unencoded ids, are read too, as are records
   * written by 1.8.2 (a time-limited grant without a user under the session key).
   */
  private callerKeys(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): OwnedKey[] {
    const owners = new Map<string, KeyOwner>();
    for (const owner of this.callerOwners(sessionId, userId, context)) {
      for (const key of [this.buildKey(toolId, owner), this.buildKey(toolId, owner, legacyKeyPart)]) {
        if (!owners.has(key)) owners.set(key, owner);
      }
    }
    return [...owners].map(([key, owner]) => ({ key, owner }));
  }

  /**
   * Every unexpired record that applies to this caller: session, user, time-limited and, when
   * `context` is given, context-specific approvals and denials. A record that names another
   * session, user or context than the key it was read from is ignored.
   */
  async getApprovals(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const records: ApprovalRecord[] = [];
    for (const { key, owner } of this.callerKeys(toolId, sessionId, userId, context)) {
      const record = this.parseRecord(await this.storage.get(key));
      if (
        record &&
        record.toolId === toolId &&
        this.isOwnedBy(record, owner) &&
        !this.isExpired(record) &&
        !this.isOverDelegated(record)
      ) {
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
    return this.writeRecord(options, ApprovalState.APPROVED);
  }

  async denyApproval(options: GrantApprovalOptions): Promise<ApprovalRecord> {
    return this.writeRecord(options, ApprovalState.DENIED);
  }

  private async writeRecord(options: GrantApprovalOptions, state: ApprovalState): Promise<ApprovalRecord> {
    this.ensureInitialized();

    assertValidTtl(options.ttlMs);
    if (options.scope === ApprovalScope.TIME_LIMITED && options.ttlMs === undefined) {
      throw new ApprovalOperationError('grant', 'a time-limited approval needs ttlMs');
    }

    const now = Date.now();
    const expiresAt = options.ttlMs !== undefined ? now + options.ttlMs : undefined;
    const grantedBy = normalizeGrantor(options.grantedBy);
    const delegationProblem =
      state === ApprovalState.APPROVED && grantorDelegationProblem(grantedBy, this.options.maxDelegationDepth);
    if (delegationProblem) throw new ApprovalOperationError('grant', delegationProblem);

    const record: ApprovalRecord = {
      toolId: options.toolId,
      state,
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

    const key = this.recordKey(options);
    const ttlSeconds = options.ttlMs !== undefined ? Math.ceil(options.ttlMs / 1000) : undefined;
    await this.storage.set(key, JSON.stringify(record), { ttlSeconds });
    this.options.audit?.record({
      type: state === ApprovalState.DENIED ? 'approval.denied' : 'approval.granted',
      ...auditFieldsOf(record),
    });

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
    const revocable = new Map<string, { record: ApprovalRecord; value: string }>();
    for (let i = 0; i < keys.length; i++) {
      const value = values[i];
      const record = this.parseRecord(value);
      if (value === null || !record || record.toolId !== toolId || record.state === ApprovalState.DENIED) continue;
      if (context) {
        const sameSession = sessionId !== undefined && record.sessionId === sessionId;
        if (
          record.context?.type === context.type &&
          record.context.identifier === context.identifier &&
          (!sessionId || sameSession) &&
          // A context approval granted to the session before it had a user applies to that user too.
          (!userId || record.userId === userId || (sameSession && record.userId === undefined))
        ) {
          revocable.set(keys[i], { record, value });
        }
      } else if ((sessionId && record.sessionId === sessionId) || (userId && record.userId === userId)) {
        revocable.set(keys[i], { record, value });
      }
    }

    const revokedAt = Date.now();
    const revokedBy = normalizeRevoker(options.revokedBy);
    let revokedAny = false;
    for (const [key, { record, value }] of revocable) {
      // A record written to the key since it was read, a denial say, is kept.
      if (!(await this.deleteIfUnchanged(key, value))) continue;
      revokedAny = true;
      const entry: ApprovalRecord = { ...record, revokedAt, revokedBy, revocationReason: options.reason };
      await this.revocations.set(key, JSON.stringify(entry), { ttlSeconds: REVOCATION_RETENTION_SECONDS });
      this.options.audit?.record({
        type: 'approval.revoked',
        ...auditFieldsOf(record),
        revokedBy,
        reason: options.reason,
      });
    }
    return revokedAny;
  }

  /**
   * Deletes the key that holds `record`, if it still does, and reports whether this call deleted
   * it. Two calls racing for one approval both find it, but only one deletes it, and a denial or
   * approval written to the key after it was read is kept. A backend without compare-and-delete
   * cannot promise that, so it throws `ApprovalConfigurationError`.
   */
  async consumeApproval(
    record: ApprovalRecord,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<boolean> {
    this.ensureInitialized();

    for (const { key, owner } of this.callerKeys(record.toolId, sessionId, userId, context)) {
      const storedValue = await this.storage.get(key);
      const stored = this.parseRecord(storedValue);
      if (storedValue !== null && stored && this.isOwnedBy(stored, owner) && isSameRecord(stored, record)) {
        return this.deleteOnce(key, storedValue);
      }
    }
    return false;
  }

  /** Deletes `key` only while it holds `storedValue`, in one step; a backend that cannot do that is refused. */
  private async deleteOnce(key: string, storedValue: string): Promise<boolean> {
    try {
      return await this.storage.deleteIfEquals(key, storedValue);
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      throw new ApprovalConfigurationError(SINGLE_USE_STORAGE_MESSAGE);
    }
  }

  /**
   * Deletes `key` only while it still holds `storedValue`: in one step where the backend allows,
   * otherwise by reading it again just before deleting it.
   */
  private async deleteIfUnchanged(key: string, storedValue: string): Promise<boolean> {
    try {
      return await this.storage.deleteIfEquals(key, storedValue);
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      if ((await this.storage.get(key)) !== storedValue) return false;
      return this.storage.delete(key);
    }
  }

  async getRevocations(
    toolId: string,
    sessionId: string,
    userId?: string,
    context?: ApprovalContext,
  ): Promise<ApprovalRecord[]> {
    this.ensureInitialized();

    const records: ApprovalRecord[] = [];
    for (const { key, owner } of this.callerKeys(toolId, sessionId, userId, context)) {
      const record = this.parseRecord(await this.revocations.get(key));
      if (record && record.toolId === toolId && this.isOwnedBy(record, owner)) records.push(record);
    }
    return records.sort((a, b) => (a.revokedAt ?? 0) - (b.revokedAt ?? 0));
  }

  async isApproved(toolId: string, sessionId: string, userId?: string, context?: ApprovalContext): Promise<boolean> {
    const approval = await this.getApproval(toolId, sessionId, userId, context);
    return approval?.state === ApprovalState.APPROVED;
  }

  async clearSessionApprovals(sessionId: string): Promise<number> {
    this.ensureInitialized();

    // Escape sessionId to prevent glob metacharacters from matching unintended keys, and match the
    // id exactly: `session:${id}` at the end of the key or followed by `:`, never a longer id. Keys
    // written up to 1.12.0 hold the id unencoded.
    const patterns = new Set<string>();
    for (const storedSessionId of [encodeKeyPart(sessionId), legacyKeyPart(sessionId)]) {
      const escapedSessionId = escapePattern(storedSessionId);
      patterns.add(`*:session:${escapedSessionId}`);
      patterns.add(`*:session:${escapedSessionId}:*`);
    }
    const keys = new Set<string>();
    for (const pattern of patterns) {
      for (const key of await this.storage.keys(pattern)) keys.add(key);
    }
    if (keys.size === 0) {
      return 0;
    }

    // A 1.12.0 key of session `a` with user `b` is also the key of session `a:user:b`.
    const candidates = [...keys];
    const values = await this.storage.mget(candidates);
    let count = 0;
    for (let index = 0; index < candidates.length; index++) {
      const value = values[index];
      if (value === null || this.parseRecord(value)?.sessionId !== sessionId) continue;
      if (await this.deleteIfUnchanged(candidates[index], value)) count++;
    }
    this.options.audit?.record({ type: 'approval.revoked', count, reason: 'session approvals cleared' });
    return count;
  }

  async clearExpiredApprovals(): Promise<number> {
    this.ensureInitialized();

    const now = Date.now();
    const keys = await this.storage.keys('*');
    const values = await this.storage.mget(keys);

    let deleted = 0;
    for (let i = 0; i < keys.length; i++) {
      const value = values[i];
      const approval = this.parseRecord(value);
      if (value === null || !approval?.expiresAt || approval.expiresAt > now) continue;
      // A record written to the key since it was read is kept.
      if (!(await this.deleteIfUnchanged(keys[i], value))) continue;
      deleted++;
      this.options.audit?.record({ type: 'approval.expired', ...auditFieldsOf(approval) });
    }
    return deleted;
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

    this.revocationStorage = undefined;
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
