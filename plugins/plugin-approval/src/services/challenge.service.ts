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
  generatePkcePair,
  generateCodeChallenge,
  type NamespacedStorage,
  type RootStorage,
  createStorage,
  createMemoryStorage,
  type StorageConfig,
} from '@frontmcp/utils';
import { ChallengeValidationError } from '../approval';
import type { ChallengeRecord } from '../types';

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
    this.ensureInitialized();

    // Compute the code challenge from the verifier
    const { codeChallenge } = generatePkcePairFromVerifier(codeVerifier);

    // Look up the record
    const recordJson = await this.storage.get(codeChallenge);
    if (!recordJson) {
      throw new ChallengeValidationError('not_found', 'Invalid or expired challenge');
    }

    const record = JSON.parse(recordJson) as ChallengeRecord;

    // Check expiration
    if (Date.now() > record.expiresAt) {
      await this.storage.delete(codeChallenge);
      throw new ChallengeValidationError('expired', 'Challenge expired');
    }

    // Delete the challenge (single-use)
    await this.storage.delete(codeChallenge);

    return record;
  }

  /**
   * Mark a challenge as having been sent to webhook.
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
    await this.storage.set(codeChallenge, JSON.stringify(record), { ttlSeconds });
    return true;
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
 * Helper to generate PKCE pair from a known verifier.
 * Used for verification.
 */
function generatePkcePairFromVerifier(codeVerifier: string): { codeVerifier: string; codeChallenge: string } {
  return {
    codeVerifier,
    codeChallenge: generateCodeChallenge(codeVerifier),
  };
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
