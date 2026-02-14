/**
 * AuthProvidersAccessor - Interface for accessing auth provider credentials
 *
 * This interface provides the runtime API for tools to access credentials
 * from registered auth providers. It supports:
 * - Credential retrieval by provider name
 * - Lazy loading with session-scoped caching
 * - Automatic token refresh for OAuth providers
 * - Headers generation for HTTP requests
 */

import { Token } from '@frontmcp/di';
import type { Credential } from '../session';
import type { ResolvedCredential, GetCredentialOptions } from './auth-providers.types';

/**
 * AuthProvidersAccessor - Runtime accessor for auth providers in tool contexts.
 *
 * Available in tool execution via `this.authProviders`:
 * ```typescript
 * @Tool({ name: 'my_tool' })
 * class MyTool extends ToolContext {
 *   async execute(input: Input) {
 *     const github = await this.authProviders.get('github');
 *     const headers = await this.authProviders.headers('github');
 *   }
 * }
 * ```
 */
export interface AuthProvidersAccessor {
  /**
   * Get a credential by provider name.
   *
   * @param providerName - Registered provider name (e.g., 'github', 'google')
   * @param options - Retrieval options (forceRefresh, scopes, timeout)
   * @returns Resolved credential or null if not available
   *
   * @example
   * ```typescript
   * const cred = await this.authProviders.get('github');
   * if (cred?.credential.type === 'oauth') {
   *   const token = cred.credential.accessToken;
   * }
   * ```
   *
   * @example Force refresh
   * ```typescript
   * const cred = await this.authProviders.get('github', { forceRefresh: true });
   * ```
   */
  get<T extends Credential = Credential>(
    providerName: string,
    options?: GetCredentialOptions,
  ): Promise<ResolvedCredential<T> | null>;

  /**
   * Get multiple credentials by provider names.
   * Executes all retrievals in parallel for efficiency.
   *
   * @param providerNames - Array of provider names
   * @param options - Retrieval options applied to all providers
   * @returns Map of provider name to resolved credential (null if not available)
   *
   * @example
   * ```typescript
   * const creds = await this.authProviders.getMany(['github', 'jira']);
   * const github = creds.get('github');
   * const jira = creds.get('jira');
   * ```
   */
  getMany(providerNames: string[], options?: GetCredentialOptions): Promise<Map<string, ResolvedCredential | null>>;

  /**
   * Get headers for a provider (convenience method).
   * Automatically handles different credential types:
   * - OAuth/Bearer: `Authorization: Bearer <token>`
   * - API Key: Uses configured header name
   * - Basic: `Authorization: Basic <base64>`
   *
   * @param providerName - Provider name
   * @returns Headers record or empty object if not available
   *
   * @example
   * ```typescript
   * const headers = await this.authProviders.headers('github');
   * const response = await fetch(url, { headers });
   * ```
   */
  headers(providerName: string): Promise<Record<string, string>>;

  /**
   * Get headers for multiple providers merged into a single object.
   * Later providers override earlier ones if headers conflict.
   *
   * @param providerNames - Array of provider names
   * @returns Merged headers from all providers
   */
  headersMany(providerNames: string[]): Promise<Record<string, string>>;

  /**
   * Force refresh a credential (for OAuth token refresh).
   * Uses the provider's refresh function if available, otherwise calls factory.
   *
   * @param providerName - Provider name to refresh
   * @returns New credential or null if refresh failed
   *
   * @example
   * ```typescript
   * // On 401 response, try refreshing
   * if (response.status === 401) {
   *   const newCred = await this.authProviders.refresh('github');
   *   if (newCred) {
   *     // Retry request with new credential
   *   }
   * }
   * ```
   */
  refresh(providerName: string): Promise<ResolvedCredential | null>;

  /**
   * Check if a provider credential is available and valid.
   * Does not trigger credential loading.
   *
   * @param providerName - Provider name
   * @returns true if credential exists in cache/vault and is valid
   */
  has(providerName: string): Promise<boolean>;

  /**
   * Check if a provider is registered (regardless of credential availability).
   *
   * @param providerName - Provider name
   * @returns true if provider is registered
   */
  isRegistered(providerName: string): boolean;

  /**
   * Invalidate cached credential (triggers reload on next access).
   * Does not remove from persistent vault storage.
   *
   * @param providerName - Provider name to invalidate
   */
  invalidate(providerName: string): void;

  /**
   * Invalidate all cached credentials for this session.
   */
  invalidateAll(): void;

  /**
   * List all registered provider names.
   */
  listProviders(): string[];

  /**
   * List all available credentials (loaded in cache or vault).
   */
  listAvailable(): Promise<string[]>;
}

/**
 * DI Token for AuthProvidersAccessor
 *
 * Used to resolve the accessor in tool contexts:
 * ```typescript
 * const accessor = this.get(AUTH_PROVIDERS_ACCESSOR);
 * ```
 */
export const AUTH_PROVIDERS_ACCESSOR = Symbol.for('frontmcp:AUTH_PROVIDERS_ACCESSOR') as Token<AuthProvidersAccessor>;
