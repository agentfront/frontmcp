/**
 * EagerCredentialLoader - Loads credentials at session initialization
 *
 * Used for providers configured with `loading: 'eager'`.
 * Credentials are loaded in parallel at session start.
 */

import type { Credential } from '../../session';
import type { CredentialFactoryContext, ResolvedCredential } from '../auth-providers.types';
import { extractCredentialExpiry } from '../credential-helpers';
import { CredentialCache } from '../credential-cache';
import type { AuthProvidersRegistry, NormalizedProviderConfig } from '../auth-providers.registry';
import type { AuthLogger } from '../../common/auth-logger.interface';

/**
 * Result of eager loading
 */
export interface EagerLoadResult {
  /** Successfully loaded credentials */
  loaded: Map<string, ResolvedCredential>;
  /** Failed provider names with errors */
  failed: Map<string, Error>;
  /** Total loading time in ms */
  duration: number;
}

/**
 * EagerCredentialLoader - Loads credentials at session initialization
 */
export class EagerCredentialLoader {
  constructor(
    private readonly registry: AuthProvidersRegistry,
    private readonly cache: CredentialCache,
    private readonly logger?: AuthLogger,
  ) {}

  /**
   * Load all eager credentials for a session.
   * Called during session initialization.
   *
   * @param context - Factory context with session/user info
   * @returns Map of provider name to resolved credential
   */
  async loadForSession(context: CredentialFactoryContext): Promise<EagerLoadResult> {
    const startTime = Date.now();
    const eagerProviders = this.registry.getEager();

    if (eagerProviders.length === 0) {
      return {
        loaded: new Map(),
        failed: new Map(),
        duration: Date.now() - startTime,
      };
    }

    this.logger?.debug(`Loading ${eagerProviders.length} eager credential providers`);

    const loaded = new Map<string, ResolvedCredential>();
    const failed = new Map<string, Error>();

    // Load all in parallel
    const results = await Promise.allSettled(
      eagerProviders.map(async (config) => {
        const credential = await this.loadOne(config, context);
        return { name: config.name, credential, config };
      }),
    );

    // Process results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, credential, config } = result.value;
        if (credential) {
          const resolved = this.wrapCredential(name, credential, config);
          loaded.set(name, resolved);
          this.cache.set(name, resolved, config.cacheTtl);
          this.logger?.debug(`Loaded eager credential: ${name}`);
        } else if (config.required) {
          failed.set(name, new Error(`Required credential "${name}" returned null`));
          this.logger?.warn(`Required eager credential "${name}" returned null`);
        }
      } else {
        const providerName = (result.reason as { providerName?: string })?.providerName || 'unknown';
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        failed.set(providerName, error);
        this.logger?.warn(`Failed to load eager credential "${providerName}":`, error.message);
      }
    }

    const duration = Date.now() - startTime;
    this.logger?.debug(`Eager loading complete: ${loaded.size} loaded, ${failed.size} failed, ${duration}ms`);

    return { loaded, failed, duration };
  }

  /**
   * Load a single credential
   */
  private async loadOne<T extends Credential>(
    config: NormalizedProviderConfig<T>,
    context: CredentialFactoryContext,
  ): Promise<T | null> {
    try {
      return await config.factory({
        ...context,
        metadata: config.metadata,
      });
    } catch (error) {
      // Add provider name to error for identification
      (error as { providerName?: string }).providerName = config.name;
      throw error;
    }
  }

  /**
   * Wrap credential with resolved metadata
   */
  private wrapCredential<T extends Credential>(
    providerId: string,
    credential: T,
    config: NormalizedProviderConfig<T>,
  ): ResolvedCredential<T> {
    return {
      credential,
      providerId,
      acquiredAt: Date.now(),
      expiresAt: extractCredentialExpiry(credential),
      isValid: true,
      scope: config.scope,
    };
  }
}
