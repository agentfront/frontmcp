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
  LazyCredentialLoader,
  type AuthorizationVault,
  type AuthProvidersVaultOptions,
  type CredentialFactoryContext,
} from '@frontmcp/auth';
import { ProviderScope, type Token } from '@frontmcp/di';
import { randomUUID } from '@frontmcp/utils';

import { FrontMcpLogger } from '../../common';
import type { FrontMcpContext } from '../../context/frontmcp-context';
import { FRONTMCP_CONTEXT } from '../../context/frontmcp-context.provider';
import { sessionScopeIdentity } from '../session-scope-identity';
import { CREDENTIAL_CACHE } from './credential-cache';

/**
 * Token for lazy loader (internal use)
 */
export const LAZY_CREDENTIAL_LOADER = Symbol.for('frontmcp:LAZY_CREDENTIAL_LOADER') as Token<LazyCredentialLoader>;

/**
 * Provider definition type for AuthProviders system.
 * Extended to include scope at top level for SDK compatibility.
 */
interface AuthProvidersProviderDef {
  provide: Token;
  scope: ProviderScope;
  name?: string;

  useFactory?: (...args: any[]) => any;
  useValue?: unknown;
  inject?: () => readonly Token[];
}

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
): AuthProvidersProviderDef[] {
  const providers: AuthProvidersProviderDef[] = [];

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
      const factoryContext: CredentialFactoryContext = {
        sessionId: sessionScopeIdentity(ctx) ?? `unidentified:${randomUUID()}`,
        userSub: ctx.authInfo?.extra?.['sub'] as string | undefined,
        userEmail: ctx.authInfo?.extra?.['email'] as string | undefined,
        userName: ctx.authInfo?.extra?.['name'] as string | undefined,
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
export function isAuthProvidersEnabled(options?: AuthProvidersVaultOptions): boolean {
  if (options?.enabled === false) {
    return false;
  }

  if (options?.enabled === true) {
    return true;
  }

  // Auto-enable if providers are registered
  return (options?.providers?.length ?? 0) > 0;
}
