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

// Accessor
export type { AuthProvidersAccessor } from './auth-providers.accessor';
export { AUTH_PROVIDERS_ACCESSOR } from './auth-providers.accessor';
export { AuthProvidersAccessorImpl } from './auth-providers.accessor.impl';

// Registry
export { AuthProvidersRegistry, AUTH_PROVIDERS_REGISTRY } from './auth-providers.registry';
export type { NormalizedProviderConfig } from './auth-providers.registry';

// Vault
export { AuthProvidersVault, AUTH_PROVIDERS_VAULT } from './auth-providers.vault';

// Credential Loaders
export { EagerCredentialLoader } from './credential-loaders/eager-loader';
export type { EagerLoadResult } from './credential-loaders/eager-loader';
export { LazyCredentialLoader } from './credential-loaders/lazy-loader';
