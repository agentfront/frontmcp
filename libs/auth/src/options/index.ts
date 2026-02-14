// options/index.ts
// Barrel export for auth options

// ============================================
// EXPLICIT INTERFACES (for better autocomplete)
// ============================================
export type {
  PublicAccessConfig,
  LocalSigningConfig,
  RemoteProviderConfig,
  TokenStorageConfig,
  TokenStorageMemory,
  TokenStorageRedis,
  TokenRefreshConfig,
  SkippedAppBehavior,
  ConsentConfig,
  FederatedAuthConfig,
  IncrementalAuthConfig,
  PublicAuthOptionsInterface,
  TransparentAuthOptionsInterface,
  OrchestratedLocalOptionsInterface,
  OrchestratedRemoteOptionsInterface,
  OrchestratedAuthOptionsInterface,
  AuthOptionsInterface,
  AuthMode,
  OrchestratedType,
} from './interfaces';

// ============================================
// SHARED SCHEMAS & TYPES
// ============================================
export {
  publicAccessConfigSchema,
  localSigningConfigSchema,
  remoteProviderConfigSchema,
  tokenStorageConfigSchema,
  tokenRefreshConfigSchema,
  skippedAppBehaviorSchema,
  consentConfigSchema,
  federatedAuthConfigSchema,
  incrementalAuthConfigSchema,
} from './shared.schemas';

export type {
  PublicAccessConfig as PublicAccessConfigZod,
  PublicAccessConfigInput,
  LocalSigningConfig as LocalSigningConfigZod,
  LocalSigningConfigInput,
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
// ORCHESTRATED MODE SCHEMAS
// ============================================
export {
  orchestratedLocalSchema,
  orchestratedRemoteSchema,
  orchestratedAuthOptionsSchema,
} from './orchestrated.schema';
export type {
  OrchestratedLocalOptions,
  OrchestratedLocalOptionsInput,
  OrchestratedRemoteOptions,
  OrchestratedRemoteOptionsInput,
  OrchestratedAuthOptions,
  OrchestratedAuthOptionsInput,
  OrchestratedType as OrchestratedTypeZod,
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
  isOrchestratedMode,
  isOrchestratedLocal,
  isOrchestratedRemote,
  allowsPublicAccess,
} from './utils';
