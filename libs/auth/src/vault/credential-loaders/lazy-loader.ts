/**
 * LazyCredentialLoader - Loads credentials on first access
 *
 * Used for providers configured with `loading: 'lazy'` (default).
 * Prevents concurrent loads of one provider for one caller (deduplication).
 */

import type { AuthLogger } from '../../common/auth-logger.interface';
import type { Credential } from '../../session';
import type { NormalizedProviderConfig } from '../auth-providers.registry';
import type { CredentialFactoryContext, ResolvedCredential } from '../auth-providers.types';
import { extractCredentialExpiry } from '../credential-helpers';

/** What tells one load apart: the provider, and the session and user the factory loads it for. */
function inFlightKey(providerName: string, context: CredentialFactoryContext): string {
  return JSON.stringify([providerName, context.sessionId, context.userSub ?? null]);
}

/**
 * LazyCredentialLoader - Loads credentials on first access
 */
export class LazyCredentialLoader {
  /** In-flight loading promises for deduplication, by provider and caller */
  private readonly loading = new Map<string, Promise<ResolvedCredential | null>>();

  constructor(private readonly logger?: AuthLogger) {}

  /**
   * Load a credential lazily.
   * If already loading for the same caller, returns the in-flight promise (deduplication).
   *
   * @param config - Provider configuration
   * @param context - Factory context
   * @returns Resolved credential or null
   */
  async load<T extends Credential>(
    config: NormalizedProviderConfig<T>,
    context: CredentialFactoryContext,
  ): Promise<ResolvedCredential<T> | null> {
    const key = inFlightKey(config.name, context);
    const existing = this.loading.get(key);
    if (existing) {
      this.logger?.debug(`Waiting for in-flight load: ${config.name}`);
      return existing as Promise<ResolvedCredential<T> | null>;
    }

    const promise = this.doLoad(config, context);
    this.loading.set(key, promise as Promise<ResolvedCredential | null>);

    try {
      return await promise;
    } finally {
      this.loading.delete(key);
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
   * Check if a credential is currently being loaded for a caller
   *
   * @param name - Provider name
   * @param context - Factory context of the caller
   * @returns true if loading is in progress
   */
  isLoading(name: string, context: CredentialFactoryContext): boolean {
    return this.loading.has(inFlightKey(name, context));
  }

  /**
   * Cancel all in-flight loads (for cleanup)
   */
  cancelAll(): void {
    this.loading.clear();
  }
}
