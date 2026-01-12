/**
 * AuthProviders Vault - Secure credential management for FrontMCP
 *
 * This module provides a production-grade credential vault system with:
 * - Multiple credential types (OAuth, API Keys, SSH, Service Accounts, etc.)
 * - Session/User/Global scoping
 * - Lazy and eager loading strategies
 * - Encrypted storage with zero-knowledge architecture
 * - Context extension for `this.authProviders` in tools
 *
 * @example Register providers
 * ```typescript
 * @FrontMcp({
 *   authProviders: {
 *     providers: [
 *       {
 *         name: 'github',
 *         scope: 'user',
 *         loading: 'lazy',
 *         factory: async (ctx) => ({
 *           type: 'oauth',
 *           accessToken: await fetchGitHubToken(ctx.userSub),
 *           tokenType: 'Bearer',
 *         }),
 *       },
 *     ],
 *   },
 * })
 * class MyServer {}
 * ```
 *
 * @example Use in tools
 * ```typescript
 * @Tool({ name: 'my_tool', authProviders: ['github'] })
 * class MyTool extends ToolContext {
 *   async execute(input: Input) {
 *     const headers = await this.authProviders.headers('github');
 *     return fetch(url, { headers });
 *   }
 * }
 * ```
 */

// Types - re-export from @frontmcp/auth
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
  CacheStats,
} from '@frontmcp/auth';

export {
  credentialScopeSchema,
  loadingStrategySchema,
  getCredentialOptionsSchema,
  credentialProviderConfigSchema,
  authProviderMappingSchema,
  authProvidersVaultOptionsSchema,
  CredentialCache,
  extractCredentialExpiry,
} from '@frontmcp/auth';

// Accessor Interface
export type { AuthProvidersAccessor } from './auth-providers.accessor';
export { AUTH_PROVIDERS_ACCESSOR } from './auth-providers.accessor';

// Registry
export type { NormalizedProviderConfig } from './auth-providers.registry';
export { AuthProvidersRegistry, AUTH_PROVIDERS_REGISTRY } from './auth-providers.registry';

// Vault Storage
export { AuthProvidersVault, AUTH_PROVIDERS_VAULT } from './auth-providers.vault';

// SDK-specific DI token for CredentialCache
export { CREDENTIAL_CACHE } from './credential-cache';

// Loaders
export { EagerCredentialLoader, type EagerLoadResult } from './credential-loaders/eager-loader';
export { LazyCredentialLoader } from './credential-loaders/lazy-loader';

// Implementation
export { AuthProvidersAccessorImpl } from './auth-providers.accessor.impl';

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
