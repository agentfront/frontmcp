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

// Transport Session Types
export {
  transportProtocolSchema,
  sseTransportStateSchema,
  streamableHttpTransportStateSchema,
  statefulHttpTransportStateSchema,
  statelessHttpTransportStateSchema,
  legacySseTransportStateSchema,
  transportStateSchema,
  transportSessionSchema,
  sessionJwtPayloadSchema,
  encryptedBlobSchema,
  storedSessionSchema,
  redisConfigSchema,
} from './transport-session.types';
export type {
  TransportProtocol,
  SessionStorageMode,
  TransportSession,
  TransportState,
  SseTransportState,
  StreamableHttpTransportState,
  StatefulHttpTransportState,
  StatelessHttpTransportState,
  LegacySseTransportState,
  SessionJwtPayload,
  StatelessSessionJwtPayload,
  StoredSession,
  EncryptedBlob as TransportEncryptedBlob,
  SessionStore,
  SessionStorageConfig,
  RedisConfig,
  SessionSecurityConfig,
} from './transport-session.types';

// Session Types (provider snapshots, create args)
export type {
  SessionMode,
  ProviderEmbedMode,
  EncBlob as SessionEncBlob,
  ProviderSnapshot,
  CreateSessionArgs,
} from './session.types';

// Session Crypto (signing/verification)
export { signSession, verifySession, isSignedSession, verifyOrParseSession } from './session-crypto';
export type { SignedSession, SessionSigningConfig } from './session-crypto';

// Session Rate Limiter
export { SessionRateLimiter, defaultSessionRateLimiter } from './session-rate-limiter';
export type { SessionRateLimiterConfig, RateLimitResult } from './session-rate-limiter';

// Transport ID Generator
export { TransportIdGenerator } from './session.transport';

// Session Utilities (auth-token, session-crypto)
export {
  isJwt,
  getTokenSignatureFingerprint,
  deriveTypedUser,
  extractBearerToken,
  getKey,
  encryptJson,
  decryptSessionJson,
  safeDecrypt,
  resetCachedKey,
  TinyTtlCache,
} from './utils';

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

// Redis Session Store
export { RedisSessionStore } from './redis-session.store';
export type { RedisSessionStoreConfig } from './redis-session.store';

// Vercel KV Session Store
export { VercelKvSessionStore } from './vercel-kv-session.store';
export type { VercelKvSessionConfig } from './vercel-kv-session.store';

// Orchestrated Token Store
export { InMemoryOrchestratedTokenStore } from './orchestrated-token.store';
export type { InMemoryOrchestratedTokenStoreOptions } from './orchestrated-token.store';

// Federated Auth Session
export {
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  createFederatedAuthSession,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
} from './federated-auth.session';
export type {
  ProviderPkce,
  ProviderTokens,
  ProviderUserInfo,
  CompletedProvider,
  FederatedAuthSession,
  FederatedAuthSessionRecord,
  FederatedAuthSessionStore,
  FederatedAuthSessionCreateParams,
} from './federated-auth.session';

// Encrypted Authorization Vault
export { redisVaultEntrySchema, EncryptedRedisVault, createEncryptedVault } from './encrypted-authorization-vault';
export type { RedisVaultEntry, EncryptionContext } from './encrypted-authorization-vault';

// Token Refresh
export { toEpochSeconds, isSoonExpiring, isSoonExpiringProvider, tryJwtExp } from './token.refresh';
export type { TokenRefreshCtx, TokenRefreshResult, TokenRefresher } from './token.refresh';
