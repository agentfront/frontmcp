/**
 * @frontmcp/auth - Browser Entry Point
 *
 * This entry point provides the browser-compatible subset of @frontmcp/auth.
 * It excludes Node.js-specific features (file-based key persistence, Redis stores,
 * Node.js machine-id) and includes only what can run in a browser environment.
 *
 * Included:
 * - Session module (memory stores, session types, schemas)
 * - JWKS module (jose is browser-compatible)
 * - Authorization, consent, common types
 * - Browser machine-id (localStorage-backed)
 * - Utils (audience validation, WWW-Authenticate parsing)
 * - CIMD module (HTTP-based, uses fetch)
 * - Vault module (auth providers types)
 *
 * Excluded:
 * - File-based dev key persistence (loadDevKey, saveDevKey, deleteDevKey, resolveKeyPath)
 * - Redis session stores (RedisSessionStore)
 * - Vercel KV session store
 * - Redis authorization store
 * - Node.js machine-id (file/path dependent)
 * - Encrypted Redis vault (Redis-dependent)
 *
 * @packageDocumentation
 */

// ============================================
// JWKS Module (browser-safe subset)
// ============================================
export { JwksService, trimSlash, normalizeIssuer, decodeJwtPayloadSafe, isDevKeyPersistenceEnabled } from './jwks';
export type { JwksServiceOptions, ProviderVerifyRef, VerifyResult, DevKeyPersistenceOptions, DevKeyData } from './jwks';

// ============================================
// UI Module (browser-safe — generates HTML strings)
// ============================================
export {
  CDN,
  DEFAULT_THEME,
  baseLayout,
  createLayout,
  authLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  escapeHtml,
  buildConsentPage,
  buildIncrementalAuthPage,
  buildFederatedLoginPage,
  buildToolConsentPage,
  buildLoginPage,
  buildErrorPage,
  renderToHtml,
} from './ui';
export type {
  ThemeColors,
  ThemeFonts,
  ThemeConfig,
  BaseLayoutOptions,
  AppAuthCard,
  ProviderCard,
  ToolCard,
} from './ui';

// ============================================
// Session Module (browser-safe subset)
// ============================================
export {
  // OAuth Authorization Store (in-memory only)
  InMemoryAuthorizationStore,
  verifyPkce,
  generatePkceChallenge,
  pkceChallengeSchema,
  authorizationCodeRecordSchema,
  // Credential schemas
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
  // Vault implementations (in-memory)
  InMemoryAuthorizationVault,
  // Storage-backed vault
  StorageAuthorizationVault,
  // Encrypted storage
  EncryptedTypedStorage,
  EncryptedStorageError,
  // Vault Encryption
  encryptedDataSchema,
  encryptedVaultEntrySchema,
  VaultEncryption,
  // Token Vault
  TokenVault,
  // Token Store (storage-backed)
  StorageTokenStore,
  // TypedStorage (re-exported from @frontmcp/utils)
  TypedStorage,
  // Crypto utilities (re-exported from @frontmcp/utils)
  hkdfSha256,
  encryptValue,
  decryptValue,
  encryptAesGcm,
  decryptAesGcm,
  // Utilities
  TinyTtlCache,
  // Transport Session
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
  // Session Crypto
  signSession,
  verifySession,
  isSignedSession,
  verifyOrParseSession,
  // Session Rate Limiter
  SessionRateLimiter,
  defaultSessionRateLimiter,
  // Transport ID Generator
  TransportIdGenerator,
  // Session Utils
  isJwt,
  getTokenSignatureFingerprint,
  deriveTypedUser,
  extractBearerToken,
  getKey,
  encryptJson,
  decryptSessionJson,
  safeDecrypt,
  resetCachedKey,
  // Orchestrated Token Store (in-memory)
  InMemoryOrchestratedTokenStore,
  // Federated Auth Session (in-memory)
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  createFederatedAuthSession,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
  // Token Refresh
  toEpochSeconds,
  isSoonExpiring,
  isSoonExpiringProvider,
  tryJwtExp,
} from './session';
export type {
  AuthorizationStore,
  PkceChallenge,
  AuthorizationCodeRecord,
  PendingAuthorizationRecord,
  RefreshTokenRecord,
  ConsentStateRecord,
  FederatedLoginStateRecord,
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
  InMemoryAuthorizationVaultOptions,
  EncryptedData,
  VaultKeyDerivationClaims,
  VaultEncryptionConfig,
  EncryptedVaultEntry,
  VaultSensitiveData,
  EncBlob,
  VaultKey,
  SecretRecord,
  TokenStore,
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
  EncryptedBlob,
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
  TransportEncryptedBlob,
  SessionStore,
  SessionStorageConfig,
  RedisConfig,
  SessionSecurityConfig,
  SessionMode,
  ProviderEmbedMode,
  SessionEncBlob,
  ProviderSnapshot,
  CreateSessionArgs,
  SignedSession,
  SessionSigningConfig,
  SessionRateLimiterConfig,
  RateLimitResult,
  InMemoryOrchestratedTokenStoreOptions,
  ProviderPkce,
  ProviderTokens,
  ProviderUserInfo,
  CompletedProvider,
  FederatedAuthSession,
  FederatedAuthSessionRecord,
  FederatedAuthSessionStore,
  FederatedAuthSessionCreateParams,
  TokenRefreshCtx,
  TokenRefreshResult,
  TokenRefresher,
} from './session';

// ============================================
// Authorization Module
// ============================================
export {
  type AuthMode,
  type AuthUser,
  type AuthorizedTool,
  type AuthorizedPrompt,
  type LLMSafeAuthContext,
  type AppAuthorizationRecord,
  type ProgressiveAuthState,
  type AuthorizationCreateCtx,
  type Authorization,
  AppAuthState,
  authModeSchema,
  authUserSchema,
  authorizedToolSchema,
  authorizedPromptSchema,
  llmSafeAuthContextSchema,
  appAuthStateSchema,
  appAuthorizationRecordSchema,
  progressiveAuthStateSchema,
  AuthorizationBase,
  getMachineId,
  PublicAuthorization,
  type PublicAuthorizationCreateCtx,
  TransparentAuthorization,
  type TransparentAuthorizationCreateCtx,
  type TransparentVerifiedPayload,
  OrchestratedAuthorization,
  type OrchestratedAuthorizationCreateCtx,
  type OrchestratedProviderState,
  type OrchestratedTokenStore,
  type TokenRefreshCallback,
  type OrchestratedAuthAccessor,
  OrchestratedAuthAccessorAdapter,
  NullOrchestratedAuthAccessor,
  ORCHESTRATED_AUTH_ACCESSOR,
} from './authorization';

// ============================================
// Common Types
// ============================================
export type { AuthLogger } from './common';
export type { RawZodShape } from './common';
export type { SessionUser } from './common';

export { jwkParametersSchema, jwkSchema, jsonWebKeySetSchema } from './common';
export type { JWKParameters, JWK, JSONWebKeySet } from './common';

export { aiPlatformTypeSchema, userClaimSchema, sessionIdPayloadSchema } from './common';
export type { TransportProtocolType, AIPlatformType, UserClaim, SessionIdPayload } from './common';

// ============================================
// Errors Module
// ============================================
export {
  AuthInternalError,
  EncryptionContextNotSetError,
  VaultLoadError,
  VaultNotFoundError,
  TokenNotAvailableError,
  TokenStoreRequiredError,
  NoProviderIdError,
  TokenLeakDetectedError,
  SessionSecretRequiredError,
  CredentialProviderAlreadyRegisteredError,
  AuthProvidersNotConfiguredError,
  OrchestratedAuthNotAvailableError,
  EncryptionKeyNotConfiguredError,
  SessionIdEmptyError,
  ElicitationSecretRequiredError,
  ScopeDeniedError,
  InMemoryStoreRequiredError,
  OrchestratorJwksNotAvailableError,
  AuthInvalidInputError,
  CredentialStorageError,
} from './errors';

// ============================================
// Options Module
// ============================================
export * from './options';

// ============================================
// Consent Module
// ============================================
export {
  consentToolItemSchema,
  consentSelectionSchema,
  consentStateSchema,
  federatedProviderItemSchema,
  federatedLoginStateSchema,
  federatedSelectionSchema,
} from './consent';
export type {
  ConsentToolItem,
  ConsentSelection,
  ConsentState,
  FederatedProviderItem,
  FederatedLoginState,
  FederatedSelection,
} from './consent';

// ============================================
// Detection Module
// ============================================
export * from './detection';

// ============================================
// Machine ID Module (browser implementation)
// ============================================
export { setMachineIdOverride } from './machine-id/machine-id.browser';

// ============================================
// Utils Module
// ============================================
export {
  buildWwwAuthenticate,
  buildPrmUrl,
  buildUnauthorizedHeader,
  buildInvalidTokenHeader,
  buildInsufficientScopeHeader,
  buildInvalidRequestHeader,
  parseWwwAuthenticate,
  validateAudience,
  createAudienceValidator,
  deriveExpectedAudience,
  AudienceValidator,
  deriveAuthorizationId,
} from './utils';
export type {
  BearerErrorCode,
  WwwAuthenticateOptions,
  AudienceValidationResult,
  AudienceValidatorOptions,
} from './utils';

// ============================================
// Vault Module (Auth Providers Types)
// ============================================
export {
  type CredentialScope,
  type LoadingStrategy,
  type GetCredentialOptions,
  type ResolvedCredential,
  type CredentialFactoryContext,
  type CredentialFactory,
  type CredentialRefreshFn,
  type CredentialHeadersFn,
  type CredentialProviderConfig,
  type AuthProviderMapping,
  type CredentialCacheEntry,
  type VaultStorageKey,
  type AuthProvidersVaultOptions,
  type CredentialEventType,
  type CredentialEvent,
  type CacheStats,
  credentialScopeSchema,
  loadingStrategySchema,
  getCredentialOptionsSchema,
  credentialProviderConfigSchema,
  authProviderMappingSchema,
  authProvidersVaultOptionsSchema,
  extractCredentialExpiry,
  CredentialCache,
  type AuthProvidersAccessor,
  AUTH_PROVIDERS_ACCESSOR,
  AuthProvidersAccessorImpl,
  AuthProvidersRegistry,
  AUTH_PROVIDERS_REGISTRY,
  type NormalizedProviderConfig,
  AuthProvidersVault,
  AUTH_PROVIDERS_VAULT,
  EagerCredentialLoader,
  type EagerLoadResult,
  LazyCredentialLoader,
} from './vault';

// ============================================
// CIMD Module (HTTP-based, works with fetch)
// ============================================
export {
  type CimdLogger,
  noopLogger,
  clientMetadataDocumentSchema,
  cimdCacheConfigSchema,
  cimdSecurityConfigSchema,
  cimdNetworkConfigSchema,
  cimdConfigSchema,
  type ClientMetadataDocument,
  type ClientMetadataDocumentInput,
  type CimdCacheConfig,
  type CimdSecurityConfig,
  type CimdNetworkConfig,
  type CimdConfig,
  type CimdConfigInput,
  type CimdResolutionResult,
  CimdError,
  InvalidClientIdUrlError,
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdSecurityError,
  RedirectUriMismatchError,
  CimdResponseTooLargeError,
  CimdDisabledError,
  isCimdClientId,
  validateClientIdUrl,
  checkSsrfProtection,
  hasOnlyLocalhostRedirectUris,
  CimdCache,
  extractCacheHeaders,
  parseCacheHeaders,
  type CimdCacheEntry,
  type CacheableHeaders,
  CimdService,
} from './cimd';
