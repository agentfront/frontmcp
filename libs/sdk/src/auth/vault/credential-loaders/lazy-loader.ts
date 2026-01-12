/**
 * LazyCredentialLoader - Loads credentials on first access
 *
 * Used for providers configured with `loading: 'lazy'` (default).
 * Prevents concurrent loads for the same provider (deduplication).
 */

import type { Credential } from '@frontmcp/auth';
import type { NormalizedProviderConfig } from '../auth-providers.registry';
import type { CredentialFactoryContext, ResolvedCredential } from '../auth-providers.types';
import { FrontMcpLogger } from '../../../common';
import { extractCredentialExpiry } from './credential-helpers';

/**
 * LazyCredentialLoader - Loads credentials on first access
 */
export class LazyCredentialLoader {
  /** In-flight loading promises for deduplication */
  private readonly loading = new Map<string, Promise<ResolvedCredential | null>>();
  private readonly logger?: FrontMcpLogger;

  constructor(logger?: FrontMcpLogger) {
    this.logger = logger?.child('LazyCredentialLoader');
  }

  /**
   * Load a credential lazily.
   * If already loading, returns the in-flight promise (deduplication).
   *
   * @param config - Provider configuration
   * @param context - Factory context
   * @returns Resolved credential or null
   */
  async load<T extends Credential>(
    config: NormalizedProviderConfig<T>,
    context: CredentialFactoryContext,
  ): Promise<ResolvedCredential<T> | null> {
    // Check for in-flight request
    const existing = this.loading.get(config.name);
    if (existing) {
      this.logger?.debug(`Waiting for in-flight load: ${config.name}`);
      return existing as Promise<ResolvedCredential<T> | null>;
    }

    // Start new load
    const promise = this.doLoad(config, context);
    this.loading.set(config.name, promise as Promise<ResolvedCredential | null>);

    try {
      return await promise;
    } finally {
      this.loading.delete(config.name);
    }
  }

  /**
   * Perform the actual credential loading
   */
  private async doLoad<T extends Credential>(
    config: NormalizedProviderConfig<T>,
    context: CredentialFactoryContext,
  ): Promise<ResolvedCredential<T> | null> {
    const startTime = Date.now();
    this.logger?.debug(`Loading lazy credential: ${config.name}`);

    try {
      const credential = await config.factory({
        ...context,
        metadata: config.metadata,
      });

      if (!credential) {
        this.logger?.debug(`Lazy credential "${config.name}" returned null`);
        return null;
      }

      const resolved: ResolvedCredential<T> = {
        credential,
        providerId: config.name,
        acquiredAt: Date.now(),
        expiresAt: extractCredentialExpiry(credential),
        isValid: true,
        scope: config.scope,
      };

      const duration = Date.now() - startTime;
      this.logger?.debug(`Loaded lazy credential "${config.name}" in ${duration}ms`);

      return resolved;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger?.warn(`Failed to load lazy credential "${config.name}" after ${duration}ms:`, error);
      throw error;
    }
  }

  /**
   * Refresh a credential using the provider's refresh function or factory
   *
   * @param config - Provider configuration
   * @param context - Factory context with existing credential
   * @returns Refreshed credential or null
   */
  async refresh<T extends Credential>(
    config: NormalizedProviderConfig<T>,
    context: CredentialFactoryContext & { existingCredential: T },
  ): Promise<ResolvedCredential<T> | null> {
    const startTime = Date.now();
    this.logger?.debug(`Refreshing credential: ${config.name}`);

    try {
      let credential: T | null;

      if (config.refresh) {
        // Use dedicated refresh function
        credential = await config.refresh(context);
      } else {
        // Fall back to factory
        credential = await config.factory(context);
      }

      if (!credential) {
        this.logger?.debug(`Credential refresh "${config.name}" returned null`);
        return null;
      }

      const resolved: ResolvedCredential<T> = {
        credential,
        providerId: config.name,
        acquiredAt: Date.now(),
        expiresAt: extractCredentialExpiry(credential),
        isValid: true,
        scope: config.scope,
      };

      const duration = Date.now() - startTime;
      this.logger?.debug(`Refreshed credential "${config.name}" in ${duration}ms`);

      return resolved;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger?.warn(`Failed to refresh credential "${config.name}" after ${duration}ms:`, error);
      throw error;
    }
  }

  /**
   * Check if a credential is currently being loaded
   *
   * @param name - Provider name
   * @returns true if loading is in progress
   */
  isLoading(name: string): boolean {
    return this.loading.has(name);
  }

  /**
   * Cancel all in-flight loads (for cleanup)
   */
  cancelAll(): void {
    this.loading.clear();
  }
}
