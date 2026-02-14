// auth/vault/index.ts

// SDK-specific DI token for CredentialCache
export { CREDENTIAL_CACHE } from './credential-cache';

// Providers (DI)
export {
  createAuthProvidersProviders,
  isAuthProvidersEnabled,
  LAZY_CREDENTIAL_LOADER,
} from './auth-providers.providers';

// Context Extension
export {
  authProvidersContextExtension,
  getAuthProviders,
  tryGetAuthProviders,
} from './auth-providers.context-extension';
