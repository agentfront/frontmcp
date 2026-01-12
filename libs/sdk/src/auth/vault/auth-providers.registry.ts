/**
 * AuthProvidersRegistry - Registry for credential providers
 *
 * Manages registration and lookup of credential providers.
 * Providers are registered at scope initialization and
 * remain available for the lifetime of the scope.
 */

import { Token } from '@frontmcp/di';
import type { Credential } from '@frontmcp/auth';
import type {
  CredentialProviderConfig,
  CredentialScope,
  LoadingStrategy,
  AuthProvidersVaultOptions,
} from './auth-providers.types';

/**
 * Normalized provider config with defaults applied
 */
export interface NormalizedProviderConfig<T extends Credential = Credential>
  extends Required<Pick<CredentialProviderConfig<T>, 'name' | 'scope' | 'loading'>> {
  description?: string;
  cacheTtl: number;
  factory: CredentialProviderConfig<T>['factory'];
  refresh?: CredentialProviderConfig<T>['refresh'];
  toHeaders?: CredentialProviderConfig<T>['toHeaders'];
  metadata?: Record<string, unknown>;
  required: boolean;
}

/**
 * AuthProvidersRegistry - Manages credential provider configurations
 */
export class AuthProvidersRegistry {
  private readonly providers = new Map<string, NormalizedProviderConfig>();
  private readonly defaultCacheTtl: number;

  constructor(options?: AuthProvidersVaultOptions) {
    this.defaultCacheTtl = options?.defaultCacheTtl ?? 3600000; // 1 hour

    if (options?.providers) {
      for (const provider of options.providers) {
        this.register(provider);
      }
    }
  }

  /**
   * Register a credential provider
   *
   * @param config - Provider configuration
   * @throws Error if provider with same name already registered
   */
  register<T extends Credential = Credential>(config: CredentialProviderConfig<T>): void {
    if (this.providers.has(config.name)) {
      throw new Error(`Credential provider "${config.name}" is already registered`);
    }

    const normalized = this.normalize(config);
    // Cast to base type for storage - generic is preserved on retrieval via get<T>()
    this.providers.set(config.name, normalized as unknown as NormalizedProviderConfig);
  }

  /**
   * Unregister a credential provider
   *
   * @param name - Provider name to unregister
   * @returns true if provider was unregistered, false if not found
   */
  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  /**
   * Get a provider configuration by name
   *
   * @param name - Provider name
   * @returns Provider config or undefined if not found
   */
  get<T extends Credential = Credential>(name: string): NormalizedProviderConfig<T> | undefined {
    return this.providers.get(name) as NormalizedProviderConfig<T> | undefined;
  }

  /**
   * Check if a provider is registered
   *
   * @param name - Provider name
   * @returns true if provider is registered
   */
  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get all registered provider names
   */
  getNames(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Get all provider configurations
   */
  getAll(): NormalizedProviderConfig[] {
    return [...this.providers.values()];
  }

  /**
   * Get providers by scope
   *
   * @param scope - Credential scope to filter by
   */
  getByScope(scope: CredentialScope): NormalizedProviderConfig[] {
    return this.getAll().filter((p) => p.scope === scope);
  }

  /**
   * Get providers by loading strategy
   *
   * @param loading - Loading strategy to filter by
   */
  getByLoading(loading: LoadingStrategy): NormalizedProviderConfig[] {
    return this.getAll().filter((p) => p.loading === loading);
  }

  /**
   * Get providers that are required
   */
  getRequired(): NormalizedProviderConfig[] {
    return this.getAll().filter((p) => p.required);
  }

  /**
   * Get providers that should be eagerly loaded
   */
  getEager(): NormalizedProviderConfig[] {
    return this.getByLoading('eager');
  }

  /**
   * Get providers that should be lazily loaded
   */
  getLazy(): NormalizedProviderConfig[] {
    return this.getByLoading('lazy');
  }

  /**
   * Get the number of registered providers
   */
  get size(): number {
    return this.providers.size;
  }

  /**
   * Check if registry is empty
   */
  isEmpty(): boolean {
    return this.providers.size === 0;
  }

  /**
   * Clear all registered providers
   */
  clear(): void {
    this.providers.clear();
  }

  /**
   * Normalize provider config with defaults
   */
  private normalize<T extends Credential>(config: CredentialProviderConfig<T>): NormalizedProviderConfig<T> {
    return {
      name: config.name,
      description: config.description,
      scope: config.scope,
      loading: config.loading,
      cacheTtl: config.cacheTtl ?? this.defaultCacheTtl,
      factory: config.factory,
      refresh: config.refresh,
      toHeaders: config.toHeaders,
      metadata: config.metadata,
      required: config.required ?? false,
    };
  }
}

/**
 * DI Token for AuthProvidersRegistry
 */
export const AUTH_PROVIDERS_REGISTRY = Symbol.for('frontmcp:AUTH_PROVIDERS_REGISTRY') as Token<AuthProvidersRegistry>;
