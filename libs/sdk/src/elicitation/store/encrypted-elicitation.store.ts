/**
 * Encrypted Elicitation Store
 *
 * Wraps an underlying ElicitationStore with session-based encryption.
 * All data is encrypted using session-derived keys before storage.
 *
 * Security Model:
 * - Pending records: encrypted with record.sessionId
 * - Fallback records: keyed by {sessionId}:{elicitId}, encrypted with sessionId
 * - Resolved results: keyed by {sessionId}:{elicitId}, encrypted with sessionId
 * - Pub/sub messages: encrypted with sessionId before publish
 *
 * Migration Support:
 * - Reads attempt decryption first, falls back to plaintext for migration
 * - All new writes are encrypted
 * - Old data expires via TTL (5-10 minutes)
 *
 * @module elicitation/store/encrypted-elicitation.store
 */

import type { FrontMcpLogger } from '../../common';
import type {
  ElicitationStore,
  PendingElicitRecord,
  ElicitResultCallback,
  ElicitUnsubscribe,
} from './elicitation.store';
import type {
  ElicitResult,
  PendingElicitFallback,
  ResolvedElicitResult,
  FallbackExecutionResult,
  FallbackResultCallback,
} from '../elicitation.types';
import {
  encryptElicitationData,
  decryptElicitationData,
  isEncryptedBlob,
  type ElicitationEncryptedBlob,
} from './elicitation-encryption';
import { ElicitationEncryptionError } from '../../errors';

/**
 * Options for creating an encrypted elicitation store.
 */
export interface EncryptedElicitationStoreOptions {
  /**
   * Server secret for key derivation.
   * Falls back to env vars if not provided.
   */
  secret?: string;

  /**
   * Logger instance for store operations.
   */
  logger?: FrontMcpLogger;
}

/**
 * Encrypted wrapper around an ElicitationStore.
 *
 * Provides transparent encryption/decryption of all stored data using
 * session-derived keys. This ensures that:
 * 1. Data at rest is encrypted
 * 2. Only requests with the correct sessionId can decrypt
 * 3. Different sessions cannot access each other's data
 */
export class EncryptedElicitationStore implements ElicitationStore {
  private readonly store: ElicitationStore;
  private readonly secret?: string;
  private readonly logger?: FrontMcpLogger;

  constructor(store: ElicitationStore, options: EncryptedElicitationStoreOptions = {}) {
    this.store = store;
    this.secret = options.secret;
    this.logger = options.logger;
  }

  // ============================================
  // Pending Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation with encryption.
   * The record is encrypted using its own sessionId.
   */
  async setPending(record: PendingElicitRecord): Promise<void> {
    const { sessionId } = record;

    try {
      // Encrypt the record using its sessionId
      const encrypted = await encryptElicitationData(record, sessionId, this.secret);

      // Store only minimal metadata + encrypted blob (sensitive fields are inside the blob)
      await this.store.setPending({
        // Only store fields needed for storage key and TTL
        sessionId: record.sessionId,
        elicitId: record.elicitId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        // All other fields (message, mode, requestedSchema, etc.) are encrypted inside the blob
        __encrypted: encrypted,
      } as unknown as PendingElicitRecord);

      this.logger?.debug('[EncryptedElicitationStore] Stored encrypted pending record', {
        sessionId: sessionId.slice(0, 8) + '...',
        elicitId: record.elicitId,
      });
    } catch (error) {
      this.logger?.error('[EncryptedElicitationStore] Failed to encrypt pending record', {
        sessionId: sessionId.slice(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a pending elicitation by session ID.
   * Attempts decryption, falls back to plaintext for migration.
   */
  async getPending(sessionId: string): Promise<PendingElicitRecord | null> {
    const stored = await this.store.getPending(sessionId);
    if (!stored) {
      return null;
    }

    return this.decryptPendingRecord(stored, sessionId);
  }

  /**
   * Delete a pending elicitation by session ID.
   */
  async deletePending(sessionId: string): Promise<void> {
    await this.store.deletePending(sessionId);
  }

  // ============================================
  // Pub/Sub Methods
  // ============================================

  /**
   * Subscribe to elicitation results with decryption.
   */
  async subscribeResult<T = unknown>(
    elicitId: string,
    callback: ElicitResultCallback<T>,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    // Wrap the callback to decrypt messages
    const decryptingCallback: ElicitResultCallback<unknown> = async (rawResult) => {
      // If sessionId provided and message is encrypted, must decrypt successfully
      if (sessionId && isEncryptedBlob(rawResult)) {
        try {
          const decrypted = await decryptElicitationData<ElicitResult<T>>(rawResult, sessionId, this.secret);
          if (decrypted) {
            callback(decrypted);
            return;
          }
          // Decryption returned null - drop message
          this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt pub/sub message (null result)', {
            elicitId,
          });
          return;
        } catch (error) {
          this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt pub/sub message', {
            elicitId,
            error: error instanceof Error ? error.message : String(error),
          });
          return; // Drop message on decryption failure
        }
      }
      // No sessionId or not encrypted - pass through
      callback(rawResult as ElicitResult<T>);
    };

    return this.store.subscribeResult(elicitId, decryptingCallback);
  }

  /**
   * Publish an elicitation result with encryption.
   */
  async publishResult<T = unknown>(elicitId: string, sessionId: string, result: ElicitResult<T>): Promise<void> {
    try {
      // Encrypt the result
      const encrypted = await encryptElicitationData(result, sessionId, this.secret);

      // Publish the encrypted blob
      await this.store.publishResult(elicitId, sessionId, encrypted as unknown as ElicitResult<T>);

      this.logger?.debug('[EncryptedElicitationStore] Published encrypted result', {
        elicitId,
        sessionId: sessionId.slice(0, 8) + '...',
      });
    } catch (error) {
      this.logger?.error('[EncryptedElicitationStore] Failed to encrypt pub/sub result', {
        elicitId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================
  // Fallback Elicitation Methods
  // ============================================

  /**
   * Store a pending elicitation fallback context with encryption.
   */
  async setPendingFallback(record: PendingElicitFallback): Promise<void> {
    const { sessionId, elicitId } = record;

    try {
      // Encrypt the record
      const encrypted = await encryptElicitationData(record, sessionId, this.secret);

      // Store only minimal metadata + encrypted blob (sensitive fields are inside the blob)
      await this.store.setPendingFallback({
        // Only store fields needed for storage key and TTL
        sessionId: record.sessionId,
        elicitId: record.elicitId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        // All other fields (toolName, toolInput, elicitMessage, elicitSchema) are encrypted inside the blob
        __encrypted: encrypted,
      } as unknown as PendingElicitFallback);

      this.logger?.debug('[EncryptedElicitationStore] Stored encrypted pending fallback', {
        elicitId,
        sessionId: sessionId.slice(0, 8) + '...',
      });
    } catch (error) {
      this.logger?.error('[EncryptedElicitationStore] Failed to encrypt pending fallback', {
        elicitId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a pending elicitation fallback by elicit ID.
   * Requires sessionId for decryption.
   */
  async getPendingFallback(elicitId: string, sessionId?: string): Promise<PendingElicitFallback | null> {
    const stored = await this.store.getPendingFallback(elicitId);
    if (!stored) {
      return null;
    }

    return this.decryptFallbackRecord(stored, sessionId);
  }

  /**
   * Delete a pending elicitation fallback by elicit ID.
   */
  async deletePendingFallback(elicitId: string): Promise<void> {
    await this.store.deletePendingFallback(elicitId);
  }

  // ============================================
  // Resolved Result Methods
  // ============================================

  /**
   * Store a resolved elicit result with encryption.
   */
  async setResolvedResult(elicitId: string, result: ElicitResult<unknown>, sessionId?: string): Promise<void> {
    if (!sessionId) {
      throw new ElicitationEncryptionError(
        `Cannot store encrypted resolved result without sessionId (elicitId: ${elicitId})`,
      );
    }

    try {
      // Create the resolved result record
      const record: ResolvedElicitResult = {
        elicitId,
        result,
        resolvedAt: Date.now(),
      };

      // Encrypt the record
      const encrypted = await encryptElicitationData(record, sessionId, this.secret);

      // Store the encrypted blob as the result
      await this.store.setResolvedResult(
        elicitId,
        {
          __encrypted: encrypted,
        } as unknown as ElicitResult<unknown>,
        sessionId,
      );

      this.logger?.debug('[EncryptedElicitationStore] Stored encrypted resolved result', {
        elicitId,
        sessionId: sessionId.slice(0, 8) + '...',
      });
    } catch (error) {
      // Re-throw ElicitationEncryptionError as-is (already includes context)
      if (error instanceof ElicitationEncryptionError) {
        throw error;
      }
      const originalError = error instanceof Error ? error : undefined;
      throw new ElicitationEncryptionError(`Failed to encrypt resolved result (elicitId: ${elicitId})`, originalError);
    }
  }

  /**
   * Get a resolved elicit result by elicit ID.
   * Requires sessionId for decryption.
   */
  async getResolvedResult(elicitId: string, sessionId?: string): Promise<ResolvedElicitResult | null> {
    const stored = await this.store.getResolvedResult(elicitId);
    if (!stored) {
      return null;
    }

    return this.decryptResolvedRecord(stored, sessionId);
  }

  /**
   * Delete a resolved elicit result by elicit ID.
   */
  async deleteResolvedResult(elicitId: string): Promise<void> {
    await this.store.deleteResolvedResult(elicitId);
  }

  // ============================================
  // Waiting Fallback Pub/Sub Methods
  // ============================================

  /**
   * Subscribe to fallback execution results with decryption.
   */
  async subscribeFallbackResult(
    elicitId: string,
    callback: FallbackResultCallback,
    sessionId?: string,
  ): Promise<ElicitUnsubscribe> {
    // Wrap the callback to decrypt messages
    const decryptingCallback: FallbackResultCallback = async (rawResult) => {
      // If sessionId provided and message is encrypted, must decrypt successfully
      if (sessionId && isEncryptedBlob(rawResult)) {
        try {
          const decrypted = await decryptElicitationData<FallbackExecutionResult>(rawResult, sessionId, this.secret);
          if (decrypted) {
            callback(decrypted);
            return;
          }
          // Decryption returned null - drop message
          this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt fallback pub/sub message (null result)', {
            elicitId,
          });
          return;
        } catch (error) {
          this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt fallback pub/sub message', {
            elicitId,
            error: error instanceof Error ? error.message : String(error),
          });
          return; // Drop message on decryption failure
        }
      }
      // No sessionId or not encrypted - pass through
      callback(rawResult);
    };

    return this.store.subscribeFallbackResult(elicitId, decryptingCallback, sessionId);
  }

  /**
   * Publish a fallback execution result with encryption.
   */
  async publishFallbackResult(elicitId: string, sessionId: string, result: FallbackExecutionResult): Promise<void> {
    try {
      // Encrypt the result
      const encrypted = await encryptElicitationData(result, sessionId, this.secret);

      // Publish the encrypted blob
      await this.store.publishFallbackResult(elicitId, sessionId, encrypted as unknown as FallbackExecutionResult);

      this.logger?.debug('[EncryptedElicitationStore] Published encrypted fallback result', {
        elicitId,
        sessionId: sessionId.slice(0, 8) + '...',
      });
    } catch (error) {
      this.logger?.error('[EncryptedElicitationStore] Failed to encrypt fallback result', {
        elicitId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================
  // Lifecycle Methods
  // ============================================

  async destroy(): Promise<void> {
    await this.store.destroy?.();
  }

  // ============================================
  // Internal Decryption Helpers
  // ============================================

  /**
   * Decrypt a pending record.
   */
  private async decryptPendingRecord(
    stored: PendingElicitRecord,
    sessionId: string,
  ): Promise<PendingElicitRecord | null> {
    // Check if the record has an encrypted blob
    const encryptedBlob = (stored as unknown as { __encrypted?: ElicitationEncryptedBlob }).__encrypted;

    if (!encryptedBlob || !isEncryptedBlob(encryptedBlob)) {
      // Migration support: return plaintext record during transition period
      // Old records without encryption will be served as-is until they expire via TTL
      this.logger?.debug('[EncryptedElicitationStore] Plaintext fallback for pending record (migration)', {
        sessionId: sessionId.slice(0, 8) + '...',
        elicitId: stored.elicitId,
      });
      return stored;
    }

    try {
      const decrypted = await decryptElicitationData<PendingElicitRecord>(encryptedBlob, sessionId, this.secret);
      if (decrypted) {
        this.logger?.debug('[EncryptedElicitationStore] Decrypted pending record', {
          sessionId: sessionId.slice(0, 8) + '...',
          elicitId: decrypted.elicitId,
        });
        return decrypted;
      }
      this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt pending record', {
        sessionId: sessionId.slice(0, 8) + '...',
      });
      return null;
    } catch (error) {
      this.logger?.warn('[EncryptedElicitationStore] Decryption error for pending record', {
        sessionId: sessionId.slice(0, 8) + '...',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Decrypt a fallback record.
   */
  private async decryptFallbackRecord(
    stored: PendingElicitFallback,
    sessionId?: string,
  ): Promise<PendingElicitFallback | null> {
    // Check if the record has an encrypted blob
    const encryptedBlob = (stored as unknown as { __encrypted?: ElicitationEncryptedBlob }).__encrypted;

    if (!encryptedBlob || !isEncryptedBlob(encryptedBlob)) {
      // Migration support: return plaintext record during transition period
      // Old records without encryption will be served as-is until they expire via TTL
      this.logger?.debug('[EncryptedElicitationStore] Plaintext fallback for fallback record (migration)', {
        elicitId: stored.elicitId,
      });
      return stored;
    }

    // Need sessionId to decrypt - try to get from stored record if not provided
    if (!sessionId) {
      sessionId = stored.sessionId;
    }

    if (!sessionId) {
      this.logger?.warn('[EncryptedElicitationStore] Cannot decrypt fallback: no sessionId', {
        elicitId: stored.elicitId,
      });
      return null;
    }

    try {
      const decrypted = await decryptElicitationData<PendingElicitFallback>(encryptedBlob, sessionId, this.secret);
      if (decrypted) {
        this.logger?.debug('[EncryptedElicitationStore] Decrypted fallback record', {
          elicitId: decrypted.elicitId,
        });
        return decrypted;
      }
      this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt fallback record', {
        elicitId: stored.elicitId,
      });
      return null;
    } catch (error) {
      this.logger?.warn('[EncryptedElicitationStore] Decryption error for fallback record', {
        elicitId: stored.elicitId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Decrypt a resolved record.
   */
  private async decryptResolvedRecord(
    stored: ResolvedElicitResult,
    sessionId?: string,
  ): Promise<ResolvedElicitResult | null> {
    // Check if the result has an encrypted blob
    const encryptedResult = stored.result as unknown as { __encrypted?: ElicitationEncryptedBlob };
    const encryptedBlob = encryptedResult?.__encrypted;

    if (!encryptedBlob || !isEncryptedBlob(encryptedBlob)) {
      // Migration support: return plaintext record during transition period
      // Old records without encryption will be served as-is until they expire via TTL
      this.logger?.debug('[EncryptedElicitationStore] Plaintext fallback for resolved result (migration)', {
        elicitId: stored.elicitId,
      });
      return stored;
    }

    if (!sessionId) {
      this.logger?.warn('[EncryptedElicitationStore] Cannot decrypt resolved result: no sessionId', {
        elicitId: stored.elicitId,
      });
      return null;
    }

    try {
      const decrypted = await decryptElicitationData<ResolvedElicitResult>(encryptedBlob, sessionId, this.secret);
      if (decrypted) {
        this.logger?.debug('[EncryptedElicitationStore] Decrypted resolved result', {
          elicitId: decrypted.elicitId,
        });
        return decrypted;
      }
      this.logger?.warn('[EncryptedElicitationStore] Failed to decrypt resolved result', {
        elicitId: stored.elicitId,
      });
      return null;
    } catch (error) {
      this.logger?.warn('[EncryptedElicitationStore] Decryption error for resolved result', {
        elicitId: stored.elicitId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
