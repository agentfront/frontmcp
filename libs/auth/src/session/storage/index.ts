/**
 * Storage Module
 *
 * Storage-adapter-backed implementations of TokenStore and AuthorizationVault.
 * Uses @frontmcp/utils/storage for unified backend support (Memory, Redis, Vercel KV, Upstash).
 */

// TypedStorage
export { TypedStorage } from './typed-storage';
export type { TypedStorageOptions, TypedSetOptions, TypedSetEntry } from './typed-storage.types';

// EncryptedTypedStorage
export { EncryptedTypedStorage, EncryptedStorageError } from './encrypted-typed-storage';
export type {
  EncryptedTypedStorageOptions,
  EncryptedSetOptions,
  EncryptedSetEntry,
  EncryptionKey,
  StoredEncryptedBlob,
  ClientKeyBinding,
} from './encrypted-typed-storage.types';

// StorageTokenStore
export { StorageTokenStore } from './storage-token-store';
export type { StorageTokenStoreOptions } from './storage-token-store';

// StorageAuthorizationVault
export { StorageAuthorizationVault } from './storage-authorization-vault';
export type { StorageAuthorizationVaultOptions } from './storage-authorization-vault';
