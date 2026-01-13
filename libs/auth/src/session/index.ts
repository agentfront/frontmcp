/**
 * Session Module
 *
 * Provides session management, credential storage, and encryption.
 */

// OAuth Authorization Store
export {
  // Classes
  InMemoryAuthorizationStore,
  RedisAuthorizationStore,
  // Functions
  verifyPkce,
  generatePkceChallenge,
  // Schemas
  pkceChallengeSchema,
  authorizationCodeRecordSchema,
} from './authorization.store';
export type {
  // Interfaces
  AuthorizationStore,
  PkceChallenge,
  AuthorizationCodeRecord,
  PendingAuthorizationRecord,
  RefreshTokenRecord,
  ConsentStateRecord,
  FederatedLoginStateRecord,
} from './authorization.store';

// Authorization Vault
export {
  // Credential type schemas
  credentialTypeSchema,
  oauthCredentialSchema,
  apiKeyCredentialSchema,
  basicAuthCredentialSchema,
  bearerCredentialSchema,
  privateKeyCredentialSchema,
  mtlsCredentialSchema,
  customCredentialSchema,
  sshKeyCredentialSchema,
  serviceAccountCredentialSchema,
  pkceOAuthCredentialSchema,
  credentialSchema,
  // App credential schemas
  appCredentialSchema,
  vaultConsentRecordSchema,
  vaultFederatedRecordSchema,
  pendingIncrementalAuthSchema,
  authorizationVaultEntrySchema,
} from './authorization-vault';
export type {
  CredentialType,
  OAuthCredential,
  ApiKeyCredential,
  BasicAuthCredential,
  BearerCredential,
  PrivateKeyCredential,
  MtlsCredential,
  CustomCredential,
  SshKeyCredential,
  ServiceAccountCredential,
  PkceOAuthCredential,
  Credential,
  AppCredential,
  VaultConsentRecord,
  VaultFederatedRecord,
  PendingIncrementalAuth,
  AuthorizationVaultEntry,
  AuthorizationVault,
} from './authorization-vault';

// Vault Encryption
export { encryptedDataSchema, encryptedVaultEntrySchema, VaultEncryption } from './vault-encryption';
export type {
  EncryptedData,
  VaultKeyDerivationClaims,
  VaultEncryptionConfig,
  EncryptedVaultEntry,
  VaultSensitiveData,
} from './vault-encryption';

// Token Vault
export { TokenVault } from './token.vault';
export type { EncBlob, VaultKey } from './token.vault';

// Token Store
export type { SecretRecord, TokenStore } from './token.store';

// Crypto utilities (re-exported from @frontmcp/utils)
export {
  hkdfSha256,
  encryptValue,
  decryptValue,
  encryptAesGcm,
  decryptAesGcm,
  type EncryptedBlob,
} from '@frontmcp/utils';

// Utilities
export { TinyTtlCache } from './utils';

// Storage-backed implementations (using @frontmcp/utils/storage)
export {
  TypedStorage,
  EncryptedTypedStorage,
  EncryptedStorageError,
  StorageTokenStore,
  StorageAuthorizationVault,
  InMemoryAuthorizationVault,
} from './storage';
export type {
  TypedStorageOptions,
  TypedSetOptions,
  TypedSetEntry,
  EncryptedTypedStorageOptions,
  EncryptedSetOptions,
  EncryptedSetEntry,
  EncryptionKey,
  StoredEncryptedBlob,
  ClientKeyBinding,
  StorageTokenStoreOptions,
  StorageAuthorizationVaultOptions,
  InMemoryAuthorizationVaultOptions,
} from './storage';
