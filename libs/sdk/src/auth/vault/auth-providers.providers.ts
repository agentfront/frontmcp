/**
 * AuthProviders DI Providers
 *
 * Defines dependency injection providers for the AuthProviders vault system.
 * These providers are registered at scope initialization when AuthProviders is enabled.
 */

import {
  AUTH_PROVIDERS_ACCESSOR,
  AUTH_PROVIDERS_REGISTRY,
  AUTH_PROVIDERS_VAULT,
  AuthProvidersAccessorImpl,
  AuthProvidersRegistry,
  AuthProvidersVault,
  CredentialCache,
  InMemoryAuthorizationVault,
  isAnonymousSubject,
  LazyCredentialLoader,
  type AuthorizationVault,
  type AuthProvidersVaultOptions,
  type CredentialFactoryContext,
} from '@frontmcp/auth';
import { ProviderScope, type Token } from '@frontmcp/di';
import { randomUUID } from '@frontmcp/utils';

import { FrontMcpLogger, type ProviderType } from '../../common';
import type { FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';
import type ProviderRegistry from '../../provider/provider.registry';
import { sessionScopeIdentity } from '../session-scope-identity';
import { CREDENTIAL_CACHE } from './credential-cache';

/**
 * Token for lazy loader (internal use)
 */
export const LAZY_CREDENTIAL_LOADER = Symbol.for('frontmcp:LAZY_CREDENTIAL_LOADER') as Token<LazyCredentialLoader>;

/**
 * Create providers for AuthProviders vault system
 *
 * @param options - Vault configuration options
 * @param baseVault - Base AuthorizationVault for storage
 * @returns Array of provider definitions
 */
export function createAuthProvidersProviders(
  options: AuthProvidersVaultOptions,
  baseVault: AuthorizationVault,
): ProviderType[] {
  const providers: ProviderType[] = [];

  // 1. AuthProvidersRegistry - GLOBAL scope (singleton)
  providers.push({
    provide: AUTH_PROVIDERS_REGISTRY,
    scope: ProviderScope.GLOBAL,
    name: 'AuthProvidersRegistry',
    useFactory: () => new AuthProvidersRegistry(options),
  });

  // 2. AuthProvidersVault - GLOBAL scope (singleton)
  providers.push({
    provide: AUTH_PROVIDERS_VAULT,
    scope: ProviderScope.GLOBAL,
    name: 'AuthProvidersVault',
    useFactory: (logger: FrontMcpLogger) =>
      new AuthProvidersVault(baseVault, options.namespace ?? 'authproviders:', logger),
    inject: () => [FrontMcpLogger] as const,
  });

  // 3. CredentialCache - CONTEXT scope (per request/session)
  providers.push({
    provide: CREDENTIAL_CACHE,
    scope: ProviderScope.CONTEXT,
    name: 'CredentialCache',
    useFactory: () => new CredentialCache(options.maxCredentialsPerSession ?? 100),
  });

  // 4. LazyCredentialLoader - CONTEXT scope (per request/session)
  providers.push({
    provide: LAZY_CREDENTIAL_LOADER,
    scope: ProviderScope.CONTEXT,
    name: 'LazyCredentialLoader',
    useFactory: (logger: FrontMcpLogger) => new LazyCredentialLoader(logger),
    inject: () => [FrontMcpLogger] as const,
  });

  // 5. AuthProvidersAccessor - CONTEXT scope (main API)
  providers.push({
    provide: AUTH_PROVIDERS_ACCESSOR,
    scope: ProviderScope.CONTEXT,
    name: 'AuthProvidersAccessor',
    useFactory: (
      registry: AuthProvidersRegistry,
      vault: AuthProvidersVault,
      cache: CredentialCache,
      loader: LazyCredentialLoader,
      ctx: FrontMcpContext,
      logger: FrontMcpLogger,
    ) => {
      // Build factory context from FrontMcpContext. `sessionId` keys `session`-scoped credentials:
      // the verified session, else the signed-in caller; an anonymous caller without a verified
      // session gets an id of its own that no other request has, so nothing is shared or kept.
      // Never `ctx.sessionId`, which under MCP 2026-07-28 is the `mcp-session-id` the client sent.
      const user = ctx.authInfo?.user;
      const signedIn = user && !isAnonymousSubject(user.sub) ? user : undefined;
      const factoryContext: CredentialFactoryContext = {
        sessionId: sessionScopeIdentity(ctx) ?? `unidentified:${randomUUID()}`,
        userSub: signedIn?.sub,
        userEmail: signedIn?.email,
        userName: signedIn?.name,
        // appId and toolId are not available in FrontMcpContext,
        // they can be set by the tool flow when calling the accessor
        vault: baseVault,
      };

      return new AuthProvidersAccessorImpl(registry, vault, cache, loader, factoryContext, logger);
    },
    inject: () =>
      [
        AUTH_PROVIDERS_REGISTRY,
        AUTH_PROVIDERS_VAULT,
        CREDENTIAL_CACHE,
        LAZY_CREDENTIAL_LOADER,
        FRONTMCP_CONTEXT,
        FrontMcpLogger,
      ] as const,
  });

  return providers;
}

/**
 * Check if AuthProviders should be enabled based on options
 */
export function isAuthProvidersEnabled(options?: AuthProvidersVaultOptions): options is AuthProvidersVaultOptions {
  if (options?.enabled === false) {
    return false;
  }

  if (options?.enabled === true) {
    return true;
  }

  // Auto-enable if providers are registered
  return (options?.providers?.length ?? 0) > 0;
}

/** Register the providers behind `this.authProviders` in a scope, when `@FrontMcp({ authProvidersVault })` enables them. */
export async function registerAuthProvidersVault(
  providers: ProviderRegistry,
  options: AuthProvidersVaultOptions | undefined,
): Promise<void> {
  if (!isAuthProvidersEnabled(options)) return;
  await providers.addDynamicProviders(createAuthProvidersProviders(options, new InMemoryAuthorizationVault()));
}
