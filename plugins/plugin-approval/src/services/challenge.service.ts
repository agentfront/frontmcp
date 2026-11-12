/**
 * PKCE Challenge Service for secure webhook approval flows.
 *
 * Implements RFC 7636 PKCE (Proof Key for Code Exchange) for secure
 * authorization between the MCP server and external approval systems.
 *
 * @module @frontmcp/plugin-approval
 */

import { Provider, ProviderScope } from '@frontmcp/sdk';
import {
  createMemoryStorage,
  createStorage,
  generateCodeChallenge,
  generatePkcePair,
  randomUUID,
  StorageNotSupportedError,
  type NamespacedStorage,
  type RootStorage,
  type StorageConfig,
} from '@frontmcp/utils';

import { ChallengeValidationError } from '../approval';
import type { ApprovalContext, ChallengeRecord } from '../types';

/** The prefix of the keys that mark a caller's request for a tool as already sent. */
const PENDING_REQUEST_PREFIX = 'pending:';

/**
 * Configuration for ChallengeService.
 */
export interface ChallengeServiceOptions {
  /**
   * Storage configuration.
   * @default { type: 'auto' }
   */
  storage?: StorageConfig;

  /**
   * Existing storage instance.
   */
  storageInstance?: RootStorage | NamespacedStorage;

  /**
   * Namespace for challenge keys.
   * @default 'approval:challenge'
   */
  namespace?: string;

  /**
   * Default challenge TTL in seconds.
   * @default 300 (5 minutes)
   */
  defaultTtlSeconds?: number;
}

/**
 * Options for creating a challenge.
 */
export interface CreateChallengeOptions {
  /** Tool ID being approved */
  toolId: string;

  /** Session ID (kept internal, never exposed) */
  sessionId: string;

  /** User ID if available */
  userId?: string;

  /** The context the call ran in, for a `context_specific` approval */
  context?: ApprovalContext;

  /** Requested approval scope */
  requestedScope: string;

  /** Request information for webhook */
  requestInfo: {
    toolName: string;
    category?: string;
    riskLevel?: string;
    customMessage?: string;
  };

  /** TTL in seconds (overrides default) */
  ttlSeconds?: number;
}

/**
 * Service for managing PKCE challenges in webhook approval flows.
 *
 * Flow:
 * 1. Create challenge: generates code_verifier + code_challenge
 * 2. Store challenge: saves code_challenge → record mapping
 * 3. Send to webhook: includes code_challenge (NOT code_verifier)
 * 4. Receive callback: validate code_verifier against stored challenge
 * 5. Grant approval if valid
 */
@Provider({
  name: 'provider:approval:challenge-service',
  description: 'PKCE challenge service for webhook approval flows',
  scope: ProviderScope.GLOBAL,
})
export class ChallengeService {
  private storage!: NamespacedStorage;
  private readonly options: Required<Omit<ChallengeServiceOptions, 'storageInstance'>> & {
    storageInstance?: RootStorage | NamespacedStorage;
  };
  private initialized = false;
  private ownedStorage = false;

  constructor(options: ChallengeServiceOptions = {}) {
    this.options = {
      storage: options.storage ?? { type: 'auto' },
      storageInstance: options.storageInstance,
      namespace: options.namespace ?? 'approval:challenge',
      defaultTtlSeconds: options.defaultTtlSeconds ?? 300,
    };
  }

  /**
   * Initialize the service.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.options.storageInstance) {
      this.storage = this.options.storageInstance.namespace(this.options.namespace);
      this.ownedStorage = false;
    } else {
      const rootStorage = await createStorage(this.options.storage);
      this.storage = rootStorage.namespace(this.options.namespace);
      this.ownedStorage = true;
    }

    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ChallengeService not initialized. Call initialize() first.');
    }
  }

  /**
   * Create a new PKCE challenge for a tool approval request.
   *
   * @returns Object containing code_verifier (keep secret) and code_challenge (send to webhook)
   */
  async createChallenge(options: CreateChallengeOptions): Promise<{
    codeVerifier: string;
    codeChallenge: string;
    expiresAt: number;
  }> {
    this.ensureInitialized();

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const now = Date.now();
    const ttlSeconds = options.ttlSeconds ?? this.options.defaultTtlSeconds;
    const expiresAt = now + ttlSeconds * 1000;

    const record: ChallengeRecord = {
      toolId: options.toolId,
      sessionId: options.sessionId,
      userId: options.userId,
      context: options.context,
      requestedScope: options.requestedScope,
      requestInfo: options.requestInfo,
      createdAt: now,
      expiresAt,
      webhookSent: false,
    };

    // Store with TTL
    await this.storage.set(codeChallenge, JSON.stringify(record), { ttlSeconds });

    return { codeVerifier, codeChallenge, expiresAt };
  }

  /**
   * Verify a code verifier and retrieve the challenge record.
   *
   * @throws ChallengeValidationError if verification fails
   */
  async verifyAndConsume(codeVerifier: string): Promise<ChallengeRecord> {
    const consumed = await this.take(codeVerifier);
    if (!consumed) {
      throw new ChallengeValidationError('not_found', 'Invalid or expired challenge');
    }
    if (Date.now() > consumed.expiresAt) {
      throw new ChallengeValidationError('expired', 'Challenge expired');
    }
    return consumed;
  }

  /**
   * The request a code verifier answers, deleted so no other callback gets it, or `undefined` when there is none: an
   * unknown or expired verifier, or one another callback already used. Of two callbacks racing with one verifier,
   * exactly one gets the record.
   */
  async consume(codeVerifier: string): Promise<ChallengeRecord | undefined> {
    const consumed = await this.take(codeVerifier);
    return consumed && Date.now() <= consumed.expiresAt ? consumed : undefined;
  }

  /** Deletes the record stored under the verifier's challenge and returns it, or `undefined` when this call didn't. */
  private async take(codeVerifier: string): Promise<ChallengeRecord | undefined> {
    this.ensureInitialized();

    // Looked up by its SHA-256, so the time a lookup takes says nothing about the stored challenges.
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const recordJson = await this.storage.get(codeChallenge);
    if (!recordJson) return undefined;
    if (!(await this.deleteIfUnchanged(codeChallenge, recordJson))) return undefined;
    return JSON.parse(recordJson) as ChallengeRecord;
  }

  /** Deletes `key` only while it still holds `value`, in one step where the backend allows. */
  private async deleteIfUnchanged(key: string, value: string): Promise<boolean> {
    try {
      return await this.storage.deleteIfEquals(key, value);
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      return this.storage.delete(key);
    }
  }

  /**
   * Marks the request named `key` as sent, for `ttlSeconds` (the default TTL when absent), and reports whether this
   * call marked it: `false` when one is already pending, so it is sent once however many calls ask.
   */
  async claimPendingRequest(key: string, ttlSeconds = this.options.defaultTtlSeconds): Promise<boolean> {
    this.ensureInitialized();
    const claim = randomUUID();
    const pendingKey = `${PENDING_REQUEST_PREFIX}${key}`;
    try {
      await this.storage.set(pendingKey, claim, { ttlSeconds, ifNotExists: true });
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      if (await this.storage.exists(pendingKey)) return false;
      await this.storage.set(pendingKey, claim, { ttlSeconds });
    }
    return (await this.storage.get(pendingKey)) === claim;
  }

  /** Clears the mark {@link claimPendingRequest} set, so the next call sends the request again. */
  async releasePendingRequest(key: string): Promise<void> {
    this.ensureInitialized();
    await this.storage.delete(`${PENDING_REQUEST_PREFIX}${key}`);
  }

  /**
   * Mark a challenge as having been sent to webhook. A challenge a callback already used stays used: this returns
   * `false` and writes nothing, as it does on a backend without conditional writes.
   */
  async markWebhookSent(codeChallenge: string): Promise<boolean> {
    this.ensureInitialized();

    const recordJson = await this.storage.get(codeChallenge);
    if (!recordJson) return false;

    const record = JSON.parse(recordJson) as ChallengeRecord;
    record.webhookSent = true;

    // Get remaining TTL
    const remainingMs = record.expiresAt - Date.now();
    if (remainingMs <= 0) {
      await this.storage.delete(codeChallenge);
      return false;
    }

    const ttlSeconds = Math.ceil(remainingMs / 1000);
    const updatedJson = JSON.stringify(record);
    try {
      await this.storage.set(codeChallenge, updatedJson, { ttlSeconds, ifExists: true });
    } catch (error) {
      if (!(error instanceof StorageNotSupportedError)) throw error;
      return false;
    }
    return (await this.storage.get(codeChallenge)) === updatedJson;
  }

  /**
   * Get a challenge record without consuming it.
   */
  async getChallenge(codeChallenge: string): Promise<ChallengeRecord | null> {
    this.ensureInitialized();

    const recordJson = await this.storage.get(codeChallenge);
    if (!recordJson) return null;

    const record = JSON.parse(recordJson) as ChallengeRecord;
    if (Date.now() > record.expiresAt) {
      await this.storage.delete(codeChallenge);
      return null;
    }

    return record;
  }

  /**
   * Delete a challenge.
   */
  async deleteChallenge(codeChallenge: string): Promise<boolean> {
    this.ensureInitialized();
    const exists = await this.storage.exists(codeChallenge);
    if (exists) {
      await this.storage.delete(codeChallenge);
      return true;
    }
    return false;
  }

  /**
   * Close the service.
   */
  async close(): Promise<void> {
    if (this.ownedStorage && this.storage) {
      await this.storage.root.disconnect();
    }
    this.initialized = false;
  }
}

/**
 * Create a ChallengeService with memory storage.
 */
export function createMemoryChallengeService(
  options: Omit<ChallengeServiceOptions, 'storage' | 'storageInstance'> = {},
): ChallengeService {
  const memoryStorage = createMemoryStorage();
  return new ChallengeService({
    ...options,
    storageInstance: memoryStorage,
  });
}
