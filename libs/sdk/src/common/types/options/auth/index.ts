// common/types/options/auth/index.ts
// Re-export all auth options from @frontmcp/auth

// ============================================
// EXPLICIT INTERFACES (for better autocomplete)
// ============================================
export type {
  PublicAccessConfig,
  LocalSigningConfig,
  ProviderConfig,
  RemoteProviderConfig,
  TokenStorageConfig,
  TokenStorageSqliteConfig,
  // Secure store config (#470)
  SecureStoreConfig,
  SecureStoreScopeType,
  SecureStoreEncryptionConfig,
  SecureStoreCustomBackend,
  TokenRefreshConfig,
  SkippedAppBehavior,
  ConsentConfig,
  FederatedAuthConfig,
  IncrementalAuthConfig,
  UpstreamProviderOptions,
  // Local-AS Dynamic Client Registration config (#462)
  LocalDcrConfig,
  LocalDcrClient,
  PublicAuthOptionsInterface,
  TransparentAuthOptionsInterface,
  LocalAuthOptionsInterface,
  RemoteAuthOptionsInterface,
  LocalOrRemoteAuthOptionsInterface,
  AuthOptionsInterface,
  AuthMode,
  // Local login customization + authenticate() (Checkpoint 3a)
  LoginFieldConfig,
  LoginSubjectConfig,
  LoginConfig,
  LoginRenderContext,
  AuthenticateInput,
  AuthenticateContext,
  AuthenticateCredential,
  AuthenticateSuccess,
  AuthenticateFailure,
  AuthenticateResult,
  AuthenticateFn,
  // Deprecated compat aliases
  OrchestratedLocalOptionsInterface,
  OrchestratedRemoteOptionsInterface,
  OrchestratedAuthOptionsInterface,
  OrchestratedType,
} from '@frontmcp/auth';

// ============================================
// SHARED SCHEMAS & TYPES
// ============================================
export {
  publicAccessConfigSchema,
  localSigningConfigSchema,
  providerConfigSchema,
  remoteProviderConfigSchema,
  flatRemoteProviderFields,
  tokenStorageConfigSchema,
  tokenStorageSqliteSchema,
  // Secure store schemas (#470)
  secureStoreConfigSchema,
  secureStoreScopeSchema,
  secureStoreEncryptionSchema,
  secureStoreCustomBackendSchema,
  tokenRefreshConfigSchema,
  skippedAppBehaviorSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
  upstreamProviderSchema,
  localDcrClientSchema,
  localDcrConfigSchema,
} from '@frontmcp/auth';

export type {
  PublicAccessConfigZod,
  PublicAccessConfigInput,
  LocalSigningConfigZod,
  LocalSigningConfigInput,
  ProviderConfigZod,
  ProviderConfigInput,
  RemoteProviderConfigZod,
  RemoteProviderConfigInput,
  TokenStorageConfigZod,
  TokenStorageConfigInput,
  // Secure store schema-inferred types (#470)
  SecureStoreConfigZod,
  SecureStoreConfigInput,
  SecureStoreScopeZod,
  SecureStoreEncryptionConfigZod,
  TokenRefreshConfigZod,
  TokenRefreshConfigInput,
  SkippedAppBehaviorZod,
  ConsentConfigZod,
  ConsentConfigInput,
  FederatedAuthConfigZod,
  FederatedAuthConfigInput,
  IncrementalAuthConfigZod,
  IncrementalAuthConfigInput,
  UpstreamProviderOptionsZod,
  UpstreamProviderOptionsInput,
  LocalDcrClientConfigZod,
  LocalDcrClientConfigInput,
  LocalDcrConfigZod,
  LocalDcrConfigInput,
  RedisConfig,
} from '@frontmcp/auth';

// ============================================
// PUBLIC MODE SCHEMA
// ============================================
export { publicAuthOptionsSchema } from '@frontmcp/auth';
export type { PublicAuthOptions, PublicAuthOptionsInput } from '@frontmcp/auth';

// ============================================
// TRANSPARENT MODE SCHEMA
// ============================================
export { transparentAuthOptionsSchema } from '@frontmcp/auth';
export type { TransparentAuthOptions, TransparentAuthOptionsInput } from '@frontmcp/auth';

// ============================================
// LOCAL / REMOTE MODE SCHEMAS
// ============================================
export {
  localAuthSchema,
  remoteAuthSchema,
  loginConfigSchema,
  authenticateFnSchema,
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
} from '@frontmcp/auth';
export type {
  LocalAuthOptions,
  LocalAuthOptionsInput,
  RemoteAuthOptions,
  RemoteAuthOptionsInput,
  LocalOrRemoteAuthOptions,
  LocalOrRemoteAuthOptionsInput,
  OrchestratedLocalOptions,
  OrchestratedLocalOptionsInput,
  OrchestratedRemoteOptions,
  OrchestratedRemoteOptionsInput,
  OrchestratedAuthOptions,
  OrchestratedAuthOptionsInput,
} from '@frontmcp/auth';

// ============================================
// UNIFIED AUTH SCHEMA
// ============================================
export { authOptionsSchema } from '@frontmcp/auth';
export type { AuthOptions, AuthOptionsInput, AuthModeZod } from '@frontmcp/auth';

// ============================================
// APP-LEVEL AUTH SCHEMA
// ============================================
export { appAuthOptionsSchema } from '@frontmcp/auth';
export type { AppAuthOptions, AppAuthOptionsInput } from '@frontmcp/auth';

// ============================================
// UTILITY FUNCTIONS
// ============================================
export {
  parseAuthOptions,
  isPublicMode,
  isTransparentMode,
  isLocalMode,
  isRemoteMode,
  isOrchestratedMode,
  isOrchestratedLocal,
  isOrchestratedRemote,
  allowsPublicAccess,
} from '@frontmcp/auth';
