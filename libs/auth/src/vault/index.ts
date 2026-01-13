/**
 * Vault Module
 *
 * Types and utilities for credential management and auth provider integration.
 */

// Types
export type {
  CredentialScope,
  LoadingStrategy,
  GetCredentialOptions,
  ResolvedCredential,
  CredentialFactoryContext,
  CredentialFactory,
  CredentialRefreshFn,
  CredentialHeadersFn,
  CredentialProviderConfig,
  AuthProviderMapping,
  CredentialCacheEntry,
  VaultStorageKey,
  AuthProvidersVaultOptions,
  CredentialEventType,
  CredentialEvent,
} from './auth-providers.types';

// Schemas
export {
  credentialScopeSchema,
  loadingStrategySchema,
  getCredentialOptionsSchema,
  credentialProviderConfigSchema,
  authProviderMappingSchema,
  authProvidersVaultOptionsSchema,
} from './auth-providers.types';

// Helpers
export { extractCredentialExpiry } from './credential-helpers';

// Cache
export { CredentialCache, type CacheStats } from './credential-cache';
