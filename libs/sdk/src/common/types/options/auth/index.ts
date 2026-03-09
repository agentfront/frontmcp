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
  TokenRefreshConfig,
  SkippedAppBehavior,
  ConsentConfig,
  FederatedAuthConfig,
  IncrementalAuthConfig,
  PublicAuthOptionsInterface,
  TransparentAuthOptionsInterface,
  LocalAuthOptionsInterface,
  RemoteAuthOptionsInterface,
  LocalOrRemoteAuthOptionsInterface,
  AuthOptionsInterface,
  AuthMode,
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
  tokenRefreshConfigSchema,
  skippedAppBehaviorSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
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
  TokenRefreshConfigZod,
  TokenRefreshConfigInput,
  SkippedAppBehaviorZod,
  ConsentConfigZod,
  ConsentConfigInput,
  FederatedAuthConfigZod,
  FederatedAuthConfigInput,
  IncrementalAuthConfigZod,
  IncrementalAuthConfigInput,
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
export { localAuthSchema, remoteAuthSchema, orchestratedLocalSchema, orchestratedRemoteSchema } from '@frontmcp/auth';
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
