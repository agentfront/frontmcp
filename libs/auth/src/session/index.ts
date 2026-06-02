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
  // Record builders (pure, backend-agnostic)
  generateAuthorizationCode,
  generateRefreshTokenValue,
  buildCodeRecord,
  buildPendingRecord,
  buildRefreshTokenRecord,
  AUTH_CODE_TTL_MS,
  PENDING_AUTH_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
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
  CreateCodeRecordParams,
  CreatePendingRecordParams,
  CreateRefreshTokenRecordParams,
} from './authorization.store';

// Storage-backed Authorization Store (memory / Redis / SQLite via StorageAdapter)
export { StorageAuthorizationStore } from './storage-authorization.store';
export type { StorageAuthorizationStoreOptions } from './storage-authorization.store';

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

// Session Credential Vault (Checkpoint 3b) — per-session encrypted credential store
export { SessionCredentialVault } from './session-credential-vault';
export type { StoredCredential, SessionCredentialVaultOptions } from './session-credential-vault';
export { createSessionCredentialVault } from './session-credential-vault.factory';
export type { CreateSessionCredentialVaultOptions } from './session-credential-vault.factory';

// Credential resume-link signing (framework-signed mid-session connect URL)
export {
  signCredentialResumeToken,
  verifyCredentialResumeToken,
  buildCredentialResumeUrl,
  DEFAULT_RESUME_TTL_MS,
} from './credential-resume-link';
export type { CredentialResumePayload } from './credential-resume-link';

// Credentials accessor (`this.credentials` ToolContext API)
export { CREDENTIALS_ACCESSOR } from './credentials-accessor';
export type {
  CredentialsAccessor,
  CredentialValue,
  CredentialNotConnected,
  CredentialConnected,
  RequireConnectResult,
  RequireConnectOptions,
} from './credentials-accessor';
export { CredentialsAccessorImpl } from './credentials-accessor.impl';
export type { CredentialsAccessorDeps } from './credentials-accessor.impl';

// Secure-store primitive (#470) — general session-scoped secure-secret store
export type { SecureStoreBackend, SecureStoreScope, SecureStoreScopeRef } from './secure-store';
export { EncryptedStorageSecureStoreBackend } from './secure-store-backends';
export type { EncryptedStorageSecureStoreBackendOptions } from './secure-store-backends';
export { SECURE_STORE_ACCESSOR } from './secure-store-accessor';
export type { SecureStoreAccessor, SecureStoreSetOptions } from './secure-store-accessor';
export { SecureStoreAccessorImpl } from './secure-store-accessor.impl';
export type { SecureStoreAccessorDeps } from './secure-store-accessor.impl';
export { createSecureStore } from './secure-store.factory';
export type { CreateSecureStoreOptions, ResolvedSecureStore, SecureStoreBackendKind } from './secure-store.factory';

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

// Storage-backed Orchestrated Token Store (memory / Redis / SQLite)
export { StorageOrchestratedTokenStore } from './storage-orchestrated-token.store';
export type { StorageOrchestratedTokenStoreOptions } from './storage-orchestrated-token.store';

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

// Storage-backed Federated Auth Session Store (memory / Redis / SQLite)
export { StorageFederatedAuthSessionStore } from './storage-federated-auth.session';
export type { StorageFederatedAuthSessionStoreOptions } from './storage-federated-auth.session';

// Remembered Consent Store (per-(user, client) tool selection)
export { InMemoryConsentStore, consentRecordKey } from './consent.store';
export type { ConsentStore, RememberedConsentRecord } from './consent.store';

// Storage-backed Remembered Consent Store (memory / Redis / SQLite)
export { StorageConsentStore } from './storage-consent.store';
export type { StorageConsentStoreOptions } from './storage-consent.store';

// Token-storage adapter factory (memory / Redis / SQLite)
export {
  createTokenStorageAdapter,
  isRedisTokenStorage,
  isSqliteTokenStorage,
  isPersistentTokenStorage,
} from './token-storage.factory';

// Encrypted Authorization Vault
export { redisVaultEntrySchema, EncryptedRedisVault, createEncryptedVault } from './encrypted-authorization-vault';
export type { RedisVaultEntry, EncryptionContext } from './encrypted-authorization-vault';

// Token Refresh
export { toEpochSeconds, isSoonExpiring, isSoonExpiringProvider, tryJwtExp } from './token.refresh';
export type { TokenRefreshCtx, TokenRefreshResult, TokenRefresher } from './token.refresh';
