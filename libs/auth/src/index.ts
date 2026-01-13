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
export {
  JwksService,
  trimSlash,
  normalizeIssuer,
  decodeJwtPayloadSafe,
  isDevKeyPersistenceEnabled,
  resolveKeyPath,
  loadDevKey,
  saveDevKey,
  deleteDevKey,
} from './jwks';
export type { JwksServiceOptions, ProviderVerifyRef, VerifyResult, DevKeyPersistenceOptions, DevKeyData } from './jwks';

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
} from './authorization';

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
} from './vault';
