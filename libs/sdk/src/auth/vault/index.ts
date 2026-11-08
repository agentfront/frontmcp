// auth/vault/index.ts

// SDK-specific DI token for CredentialCache
export { CREDENTIAL_CACHE } from './credential-cache';

// Providers (DI)
export {
  type AuthProvidersVaultStore,
  createAuthProvidersProviders,
  isAuthProvidersEnabled,
  LAZY_CREDENTIAL_LOADER,
  registerAuthProvidersVault,
} from './auth-providers.providers';
