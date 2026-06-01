// options/index.ts
// Barrel export for auth options

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
  TokenRefreshConfig,
  SkippedAppBehavior,
  ConsentConfig,
  FederatedAuthConfig,
  IncrementalAuthConfig,
  UpstreamProviderOptions,
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
} from './interfaces';

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
  tokenRefreshConfigSchema,
  skippedAppBehaviorSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
  upstreamProviderSchema,
} from './shared.schemas';

export type {
  PublicAccessConfig as PublicAccessConfigZod,
  PublicAccessConfigInput,
  LocalSigningConfig as LocalSigningConfigZod,
  LocalSigningConfigInput,
  ProviderConfig as ProviderConfigZod,
  ProviderConfigInput,
  RemoteProviderConfig as RemoteProviderConfigZod,
  RemoteProviderConfigInput,
  TokenStorageConfig as TokenStorageConfigZod,
  TokenStorageConfigInput,
  TokenRefreshConfig as TokenRefreshConfigZod,
  TokenRefreshConfigInput,
  SkippedAppBehavior as SkippedAppBehaviorZod,
  ConsentConfig as ConsentConfigZod,
  ConsentConfigInput,
  FederatedAuthConfig as FederatedAuthConfigZod,
  FederatedAuthConfigInput,
  IncrementalAuthConfig as IncrementalAuthConfigZod,
  IncrementalAuthConfigInput,
  UpstreamProviderOptions as UpstreamProviderOptionsZod,
  UpstreamProviderOptionsInput,
  RedisConfig,
} from './shared.schemas';

// ============================================
// PUBLIC MODE SCHEMA
// ============================================
export { publicAuthOptionsSchema } from './public.schema';
export type { PublicAuthOptions, PublicAuthOptionsInput } from './public.schema';

// ============================================
// TRANSPARENT MODE SCHEMA
// ============================================
export { transparentAuthOptionsSchema } from './transparent.schema';
export type { TransparentAuthOptions, TransparentAuthOptionsInput } from './transparent.schema';

// ============================================
// LOCAL / REMOTE MODE SCHEMAS
// ============================================
export {
  localAuthSchema,
  remoteAuthSchema,
  // Local login customization + authenticate() schemas (Checkpoint 3a)
  loginConfigSchema,
  authenticateFnSchema,
  // Deprecated compat aliases
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
} from './orchestrated.schema';
export type {
  LocalAuthOptions,
  LocalAuthOptionsInput,
  RemoteAuthOptions,
  RemoteAuthOptionsInput,
  LocalOrRemoteAuthOptions,
  LocalOrRemoteAuthOptionsInput,
  // Deprecated compat aliases
  OrchestratedLocalOptions,
  OrchestratedLocalOptionsInput,
  OrchestratedRemoteOptions,
  OrchestratedRemoteOptionsInput,
  OrchestratedAuthOptions,
  OrchestratedAuthOptionsInput,
} from './orchestrated.schema';

// ============================================
// UNIFIED AUTH SCHEMA
// ============================================
export { authOptionsSchema } from './schema';
export type { AuthOptions, AuthOptionsInput, AuthMode as AuthModeZod } from './schema';

// ============================================
// APP-LEVEL AUTH SCHEMA
// ============================================
export { appAuthOptionsSchema } from './app-auth.schema';
export type { AppAuthOptions, AppAuthOptionsInput } from './app-auth.schema';

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
} from './utils';
