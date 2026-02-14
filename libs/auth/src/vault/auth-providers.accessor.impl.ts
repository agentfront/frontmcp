/**
 * AuthProvidersAccessorImpl - Implementation of AuthProvidersAccessor
 *
 * Provides runtime access to credential providers in tool contexts.
 * Handles caching, vault storage, lazy loading, and credential refresh.
 */

import type { Credential } from '../session';
import type { CredentialFactoryContext, GetCredentialOptions, ResolvedCredential } from './auth-providers.types';
import { extractCredentialExpiry } from './credential-helpers';
import { CredentialCache } from './credential-cache';
import { base64Encode } from '@frontmcp/utils';
import type { AuthProvidersAccessor } from './auth-providers.accessor';
import type { AuthProvidersRegistry, NormalizedProviderConfig } from './auth-providers.registry';
import type { AuthProvidersVault } from './auth-providers.vault';
import type { LazyCredentialLoader } from './credential-loaders/lazy-loader';
import type { AuthLogger } from '../common/auth-logger.interface';

/**
 * AuthProvidersAccessorImpl - Runtime implementation
 */
export class AuthProvidersAccessorImpl implements AuthProvidersAccessor {
  constructor(
    private readonly registry: AuthProvidersRegistry,
    private readonly vault: AuthProvidersVault,
    private readonly cache: CredentialCache,
    private readonly loader: LazyCredentialLoader,
    private readonly context: CredentialFactoryContext,
    private readonly logger?: AuthLogger,
  ) {}

  async get<T extends Credential = Credential>(
    providerName: string,
    options?: GetCredentialOptions,
  ): Promise<ResolvedCredential<T> | null> {
    // 1. Check if provider is registered
    const config = this.registry.get<T>(providerName);
    if (!config) {
      this.logger?.debug(`Provider "${providerName}" is not registered`);
      return null;
    }

    // 2. Check cache (unless force refresh)
    if (!options?.forceRefresh) {
      const cached = this.cache.get<T>(providerName);
      if (cached && this.isValid(cached)) {
        this.logger?.debug(`Cache hit for "${providerName}"`);
        return cached;
      }
    }

    // 3. Try vault storage
    if (!options?.forceRefresh) {
      const fromVault = await this.loadFromVault<T>(providerName, config);
      if (fromVault && this.isValid(fromVault)) {
        this.cache.set(providerName, fromVault, config.cacheTtl);
        this.logger?.debug(`Vault hit for "${providerName}"`);
        return fromVault;
      }
    }

    // 4. Load via factory
    const loaded = await this.loader.load(config, this.context);
    if (!loaded) {
      return null;
    }

    // 5. Store in vault and cache
    await this.storeInVault(providerName, loaded, config);
    this.cache.set(providerName, loaded, config.cacheTtl);

    return loaded as ResolvedCredential<T>;
  }

  async getMany(
    providerNames: string[],
    options?: GetCredentialOptions,
  ): Promise<Map<string, ResolvedCredential | null>> {
    const results = new Map<string, ResolvedCredential | null>();

    // Load all in parallel
    const promises = providerNames.map(async (name) => {
      const result = await this.get(name, options);
      return { name, result };
    });

    const settled = await Promise.allSettled(promises);

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.set(outcome.value.name, outcome.value.result);
      } else {
        // Find the provider name from the error context if possible
        this.logger?.warn('Failed to load credential:', outcome.reason);
      }
    }

    return results;
  }

  async headers(providerName: string): Promise<Record<string, string>> {
    const resolved = await this.get(providerName);
    if (!resolved) {
      return {};
    }

    const config = this.registry.get(providerName);
    if (config?.toHeaders) {
      return config.toHeaders(resolved.credential);
    }

    return this.defaultHeaders(resolved.credential);
  }

  async headersMany(providerNames: string[]): Promise<Record<string, string>> {
    const allHeaders: Record<string, string> = {};

    for (const name of providerNames) {
      const headers = await this.headers(name);
      Object.assign(allHeaders, headers);
    }

    return allHeaders;
  }

  async refresh(providerName: string): Promise<ResolvedCredential | null> {
    const config = this.registry.get(providerName);
    if (!config) {
      this.logger?.debug(`Cannot refresh: provider "${providerName}" not registered`);
      return null;
    }

    // Get existing credential for refresh context
    const existing = this.cache.get(providerName);
    const existingCredential = existing?.credential;

    try {
      const refreshed = await this.loader.refresh(config, {
        ...this.context,
        existingCredential: existingCredential as Credential,
      });

      if (!refreshed) {
        return null;
      }

      // Update vault and cache
      await this.storeInVault(providerName, refreshed, config);
      this.cache.set(providerName, refreshed, config.cacheTtl);

      return refreshed;
    } catch (error) {
      this.logger?.warn(`Failed to refresh credential "${providerName}":`, error);
      return null;
    }
  }

  async has(providerName: string): Promise<boolean> {
    // Check cache first, but validate the entry
    const cached = this.cache.get(providerName);
    if (cached) {
      if (this.isValid(cached)) {
        return true;
      }
      // Cached credential is invalid/expired, remove it
      this.cache.invalidate(providerName);
    }

    // Check vault
    const config = this.registry.get(providerName);
    if (!config) {
      return false;
    }

    const fromVault = await this.loadFromVault(providerName, config);
    return fromVault !== null && this.isValid(fromVault);
  }

  isRegistered(providerName: string): boolean {
    return this.registry.has(providerName);
  }

  invalidate(providerName: string): void {
    this.cache.invalidate(providerName);
    this.logger?.debug(`Invalidated cache for "${providerName}"`);
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
    this.logger?.debug('Invalidated all cached credentials');
  }

  listProviders(): string[] {
    return this.registry.getNames();
  }

  async listAvailable(): Promise<string[]> {
    const available: string[] = [];

    for (const name of this.registry.getNames()) {
      if (await this.has(name)) {
        available.push(name);
      }
    }

    return available;
  }

  /**
   * Load credential from vault storage
   */
  private async loadFromVault<T extends Credential>(
    providerName: string,
    config: NormalizedProviderConfig<T>,
  ): Promise<ResolvedCredential<T> | null> {
    try {
      const credential = await this.vault.getCredential<T>(
        this.context.sessionId,
        providerName,
        config.scope,
        this.context.userSub,
      );

      if (!credential) {
        return null;
      }

      return {
        credential,
        providerId: providerName,
        acquiredAt: Date.now(), // We don't store acquiredAt in vault
        expiresAt: extractCredentialExpiry(credential),
        isValid: true,
        scope: config.scope,
      };
    } catch (error) {
      this.logger?.warn(`Failed to load from vault "${providerName}":`, error);
      return null;
    }
  }

  /**
   * Store credential in vault storage
   */
  private async storeInVault<T extends Credential>(
    providerName: string,
    resolved: ResolvedCredential<T>,
    config: NormalizedProviderConfig<T>,
  ): Promise<void> {
    try {
      await this.vault.storeCredential(
        this.context.sessionId,
        providerName,
        resolved.credential,
        config.scope,
        this.context.userSub,
      );
    } catch (error) {
      this.logger?.warn(`Failed to store in vault "${providerName}":`, error);
    }
  }

  /**
   * Check if a resolved credential is still valid
   */
  private isValid(resolved: ResolvedCredential): boolean {
    if (!resolved.isValid) {
      return false;
    }

    if (resolved.expiresAt && Date.now() >= resolved.expiresAt) {
      return false;
    }

    return true;
  }

  /**
   * Generate default headers for a credential type
   */
  private defaultHeaders(credential: Credential): Record<string, string> {
    switch (credential.type) {
      case 'oauth':
      case 'oauth_pkce':
        return { Authorization: `${credential.tokenType} ${credential.accessToken}` };

      case 'bearer':
        return { Authorization: `Bearer ${credential.token}` };

      case 'api_key':
        if (credential.headerPrefix) {
          return { [credential.headerName]: `${credential.headerPrefix}${credential.key}` };
        }
        return { [credential.headerName]: credential.key };

      case 'basic': {
        const value = `${credential.username}:${credential.password}`;
        const encoded = credential.encodedValue ?? base64Encode(new TextEncoder().encode(value));
        return { Authorization: `Basic ${encoded}` };
      }

      case 'custom':
        return credential.headers ?? {};

      // SSH keys, mTLS, private keys, service accounts don't have standard HTTP headers
      case 'ssh_key':
      case 'mtls':
      case 'private_key':
      case 'service_account':
        return {};

      default:
        return {};
    }
  }
}
