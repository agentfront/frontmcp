/**
 * Storage Module
 *
 * Storage-adapter-backed implementations of TokenStore and AuthorizationVault.
 * Uses @frontmcp/utils/storage for unified backend support (Memory, Redis, Vercel KV, Upstash).
 */

// Re-export TypedStorage from @frontmcp/utils for backwards compatibility
export { TypedStorage } from '@frontmcp/utils';
export type { TypedStorageOptions, TypedSetOptions, TypedSetEntry } from '@frontmcp/utils';

// Re-export EncryptedTypedStorage from @frontmcp/utils for backwards compatibility
export { EncryptedTypedStorage, EncryptedStorageError } from '@frontmcp/utils';
export type {
  EncryptedTypedStorageOptions,
  EncryptedSetOptions,
  EncryptedSetEntry,
  EncryptionKey,
  StoredEncryptedBlob,
  ClientKeyBinding,
} from '@frontmcp/utils';

// StorageTokenStore
export { StorageTokenStore } from './storage-token-store';
export type { StorageTokenStoreOptions } from './storage-token-store';

// StorageAuthorizationVault
export { StorageAuthorizationVault } from './storage-authorization-vault';
export type { StorageAuthorizationVaultOptions } from './storage-authorization-vault';

// InMemoryAuthorizationVault
export { InMemoryAuthorizationVault } from './in-memory-authorization-vault';
export type { InMemoryAuthorizationVaultOptions } from './in-memory-authorization-vault';
