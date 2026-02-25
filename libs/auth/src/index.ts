/**
 * @frontmcp/auth
 *
 * FrontMCP Auth - Authentication, session management, and credential vault.
 *
 * This library provides standalone authentication components that can be used
 * independently or as part of the @frontmcp/sdk.
 *
 * @example
 * ```typescript
 * import { JwksService, buildLoginPage, InMemoryAuthorizationVault } from '@frontmcp/auth';
 *
 * // JWKS management
 * const jwks = new JwksService({ orchestratorAlg: 'RS256' });
 * const publicJwks = await jwks.getPublicJwks();
 *
 * // Auth UI templates
 * const html = buildLoginPage({
 *   clientName: 'My App',
 *   scope: 'openid profile',
 *   pendingAuthId: 'abc123',
 *   callbackPath: '/oauth/callback',
 * });
 *
 * // Credential vault
 * const vault = new InMemoryAuthorizationVault();
 * const entry = await vault.create({
 *   userSub: 'user123',
 *   clientId: 'client456',
 * });
 * ```
 */

// ============================================
// JWKS Module
// ============================================
export { JwksService, trimSlash, normalizeIssuer, decodeJwtPayloadSafe } from './jwks';
export type { JwksServiceOptions, ProviderVerifyRef, VerifyResult } from './jwks';

// ============================================
// UI Module
// ============================================
export {
  // Base Layout
  CDN,
  DEFAULT_THEME,
  baseLayout,
  createLayout,
  authLayout,
  centeredCardLayout,
  wideLayout,
  extraWideLayout,
  escapeHtml,
  // Templates
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
// Session Module
// ============================================
export {
  // OAuth Authorization Store
  InMemoryAuthorizationStore,
  RedisAuthorizationStore,
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
  // Vault implementations
  InMemoryAuthorizationVault,
  // Vault implementations (storage-backed - recommended)
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
  // Redis Session Store
  RedisSessionStore,
  // Vercel KV Session Store
  VercelKvSessionStore,
  // Orchestrated Token Store
  InMemoryOrchestratedTokenStore,
  // Federated Auth Session
  InMemoryFederatedAuthSessionStore,
  toSessionRecord,
  fromSessionRecord,
  createFederatedAuthSession,
  isSessionComplete,
  getNextProvider,
  completeCurrentProvider,
  startNextProvider,
  // Encrypted Authorization Vault
  redisVaultEntrySchema,
  EncryptedRedisVault,
  createEncryptedVault,
  // Token Refresh
  toEpochSeconds,
  isSoonExpiring,
  isSoonExpiringProvider,
  tryJwtExp,
} from './session';
export type {
  // OAuth Authorization Store types
  AuthorizationStore,
  PkceChallenge,
  AuthorizationCodeRecord,
  PendingAuthorizationRecord,
  RefreshTokenRecord,
  ConsentStateRecord,
  FederatedLoginStateRecord,
  // Credential types
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
  // Storage types
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
  // Crypto types (re-exported from @frontmcp/utils)
  EncryptedBlob,
  // Transport Session types
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
  // Session types
  SessionMode,
  ProviderEmbedMode,
  SessionEncBlob,
  ProviderSnapshot,
  CreateSessionArgs,
  // Session Crypto types
  SignedSession,
  SessionSigningConfig,
  // Session Rate Limiter types
  SessionRateLimiterConfig,
  RateLimitResult,
  // Redis Session Store types
  RedisSessionStoreConfig,
  // Vercel KV Session Store types
  VercelKvSessionConfig,
  // Orchestrated Token Store types
  InMemoryOrchestratedTokenStoreOptions,
  // Federated Auth Session types
  ProviderPkce,
  ProviderTokens,
  ProviderUserInfo,
  CompletedProvider,
  FederatedAuthSession,
  FederatedAuthSessionRecord,
  FederatedAuthSessionStore,
  FederatedAuthSessionCreateParams,
  // Encrypted Authorization Vault types
  RedisVaultEntry,
  EncryptionContext,
  // Token Refresh types
  TokenRefreshCtx,
  TokenRefreshResult,
  TokenRefresher,
} from './session';

// ============================================
// Authorization Module
// ============================================
export {
  // Types
  type AuthMode,
  type AuthUser,
  type AuthorizedTool,
  type AuthorizedPrompt,
  type LLMSafeAuthContext,
  type AppAuthorizationRecord,
  type ProgressiveAuthState,
  type AuthorizationCreateCtx,
  type Authorization,
  // Enums
  AppAuthState,
  // Schemas
  authModeSchema,
  authUserSchema,
  authorizedToolSchema,
  authorizedPromptSchema,
  llmSafeAuthContextSchema,
  appAuthStateSchema,
  appAuthorizationRecordSchema,
  progressiveAuthStateSchema,
  // Base class
  AuthorizationBase,
  getMachineId,
  // Mode-specific implementations
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
  // Orchestrated auth accessor
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

// Common JWT Types
export { jwkParametersSchema, jwkSchema, jsonWebKeySetSchema } from './common';
export type { JWKParameters, JWK, JSONWebKeySet } from './common';

// Common Session Types
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
// Machine ID Module
// ============================================
export { setMachineIdOverride } from './machine-id';

// ============================================
// Utils Module
// ============================================
export {
  // WWW-Authenticate
  buildWwwAuthenticate,
  buildPrmUrl,
  buildUnauthorizedHeader,
  buildInvalidTokenHeader,
  buildInsufficientScopeHeader,
  buildInvalidRequestHeader,
  parseWwwAuthenticate,
  // Audience Validation
  validateAudience,
  createAudienceValidator,
  deriveExpectedAudience,
  AudienceValidator,
  // Authorization ID
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
  // Types (re-exported)
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
  // Schemas
  credentialScopeSchema,
  loadingStrategySchema,
  getCredentialOptionsSchema,
  credentialProviderConfigSchema,
  authProviderMappingSchema,
  authProvidersVaultOptionsSchema,
  // Helpers
  extractCredentialExpiry,
  // Cache
  CredentialCache,
  // Accessor
  type AuthProvidersAccessor,
  AUTH_PROVIDERS_ACCESSOR,
  AuthProvidersAccessorImpl,
  // Registry
  AuthProvidersRegistry,
  AUTH_PROVIDERS_REGISTRY,
  type NormalizedProviderConfig,
  // Vault
  AuthProvidersVault,
  AUTH_PROVIDERS_VAULT,
  // Credential Loaders
  EagerCredentialLoader,
  type EagerLoadResult,
  LazyCredentialLoader,
} from './vault';

// ============================================
// CIMD Module
// ============================================
export {
  // Logger
  type CimdLogger,
  noopLogger,
  // Types & Schemas
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
  // Errors
  CimdError,
  InvalidClientIdUrlError,
  CimdFetchError,
  CimdValidationError,
  CimdClientIdMismatchError,
  CimdSecurityError,
  RedirectUriMismatchError,
  CimdResponseTooLargeError,
  CimdDisabledError,
  // Validator
  isCimdClientId,
  validateClientIdUrl,
  checkSsrfProtection,
  hasOnlyLocalhostRedirectUris,
  // Cache
  InMemoryCimdCache,
  extractCacheHeaders,
  parseCacheHeaders,
  type CimdCacheEntry,
  type CacheableHeaders,
  // Service
  CimdService,
} from './cimd';
