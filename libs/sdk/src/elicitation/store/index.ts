/**
 * Elicitation Store Module
 *
 * Storage abstractions for elicitation state management.
 * Uses @frontmcp/utils storage for unified backend support.
 *
 * @module elicitation/store
 */

// Store interface
export type {
  ElicitationStore,
  PendingElicitRecord,
  ElicitResultCallback,
  ElicitUnsubscribe,
} from './elicitation.store';

// Store implementations
export { StorageElicitationStore } from './storage-elicitation.store';
export { EncryptedElicitationStore, type EncryptedElicitationStoreOptions } from './encrypted-elicitation.store';

// Encryption utilities
export {
  deriveElicitationKey,
  encryptElicitationData,
  decryptElicitationData,
  isEncryptedBlob,
  serializeElicitationBlob,
  deserializeElicitationBlob,
  encryptAndSerialize,
  deserializeAndDecrypt,
  tryDecryptStoredValue,
  getElicitationSecret,
  isElicitationEncryptionAvailable,
  type ElicitationEncryptedBlob,
  type ElicitationEncryptionConfig,
} from './elicitation-encryption';

// Factory functions
export {
  createElicitationStore,
  createMemoryElicitationStore,
  createElicitationStoreFromStorage,
  type ElicitationStoreOptions,
  type ElicitationStoreResult,
} from './elicitation-store.factory';
