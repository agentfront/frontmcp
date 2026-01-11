import {
  AgentLlmAdapter,
  AgentLlmConfig,
  AgentLlmBuiltinConfig,
  AgentLlmAdapterConfig,
  AgentApiKeyConfig,
  WithConfig,
} from '../../common';
import { LlmAdapterError } from './base.adapter';
import { createProviderAdapterSync } from './providers';
import { ConfigResolver, ConfigResolutionContext, generateFallbacks } from '../../builtin/config/config-resolver';

// Re-export ConfigResolver for backwards compatibility
export type { ConfigResolver } from '../../builtin/config/config-resolver';

/**
 * Interface for provider registry (DI).
 */
export interface ProviderResolver {
  /**
   * Get a provider by token.
   */
  get<T>(token: symbol | { new (...args: unknown[]): T }): T;

  /**
   * Try to get a provider, returning undefined if not found.
   */
  tryGet<T>(token: symbol | { new (...args: unknown[]): T }): T | undefined;
}

// ============================================================================
// API Key Resolution
// ============================================================================

/**
 * Resolve a WithConfig value using the appropriate fallback strategy.
 *
 * @param withConfig - The WithConfig object
 * @param configResolver - Config resolver instance
 * @param entityContext - Optional entity context for auto-fallbacks
 * @returns The resolved value or undefined if not found
 */
function resolveWithConfigValue<T>(
  withConfig: WithConfig<T>,
  configResolver: ConfigResolver,
  entityContext?: ConfigResolutionContext,
): T | undefined {
  // Determine which paths to try
  let paths: string[];

  if (withConfig.fallbacks === false) {
    // Fallbacks disabled - direct lookup only
    paths = [withConfig.configPath];
  } else if (Array.isArray(withConfig.fallbacks)) {
    // Custom fallbacks provided
    paths = withConfig.fallbacks;
  } else if (entityContext) {
    // Auto-generate fallbacks from entity context
    paths = generateFallbacks(withConfig.configPath, entityContext);
  } else {
    // No context - direct lookup
    paths = [withConfig.configPath];
  }

  // Try each path in order
  for (const path of paths) {
    const value = configResolver.tryGet<T>(path);
    if (value !== undefined) {
      return withConfig.transform ? withConfig.transform(value as unknown) : value;
    }
  }

  return undefined;
}

/**
 * Resolve an API key from various sources.
 *
 * @param config - API key configuration (string, env var, or WithConfig)
 * @param configResolver - Optional config resolver for WithConfig values
 * @param entityContext - Optional entity context for auto-fallbacks
 */
export function resolveApiKey(
  config: AgentApiKeyConfig,
  configResolver?: ConfigResolver,
  entityContext?: ConfigResolutionContext,
): string {
  // Direct string
  if (typeof config === 'string') {
    return config;
  }

  // Environment variable
  if ('env' in config) {
    const value = process.env[config.env];
    if (!value) {
      throw new LlmAdapterError(`Environment variable ${config.env} is not set`, 'config', 'missing_env_var');
    }
    return value;
  }

  // WithConfig reference with fallback support
  if ('configPath' in config) {
    if (!configResolver) {
      throw new LlmAdapterError(
        `ConfigResolver required to resolve configPath: ${config.configPath}`,
        'config',
        'no_resolver',
      );
    }

    const value = resolveWithConfigValue(config, configResolver, entityContext);

    if (value === undefined) {
      // Build helpful error message showing what was tried
      let triedPaths: string[];
      if (config.fallbacks === false) {
        triedPaths = [config.configPath];
      } else if (Array.isArray(config.fallbacks)) {
        triedPaths = config.fallbacks;
      } else if (entityContext) {
        triedPaths = generateFallbacks(config.configPath, entityContext);
      } else {
        triedPaths = [config.configPath];
      }

      throw new LlmAdapterError(
        `Config key "${config.configPath}" not found. Tried: ${triedPaths.join(', ')}`,
        'config',
        'key_not_found',
      );
    }

    return value;
  }

  throw new LlmAdapterError('Invalid API key configuration', 'config', 'invalid_config');
}

/**
 * Resolve a string value that may be a WithConfig reference.
 *
 * @param value - String or WithConfig reference
 * @param configResolver - Optional config resolver
 * @param entityContext - Optional entity context for auto-fallbacks
 */
export function resolveStringValue(
  value: string | WithConfig<string>,
  configResolver?: ConfigResolver,
  entityContext?: ConfigResolutionContext,
): string {
  if (typeof value === 'string') {
    return value;
  }

  if (!configResolver) {
    throw new LlmAdapterError(
      `ConfigResolver required to resolve configPath: ${value.configPath}`,
      'config',
      'no_resolver',
    );
  }

  const resolved = resolveWithConfigValue(value, configResolver, entityContext);

  if (resolved === undefined) {
    // Build helpful error message showing what was tried
    let triedPaths: string[];
    if (value.fallbacks === false) {
      triedPaths = [value.configPath];
    } else if (Array.isArray(value.fallbacks)) {
      triedPaths = value.fallbacks;
    } else if (entityContext) {
      triedPaths = generateFallbacks(value.configPath, entityContext);
    } else {
      triedPaths = [value.configPath];
    }

    throw new LlmAdapterError(
      `Config key "${value.configPath}" not found. Tried: ${triedPaths.join(', ')}`,
      'config',
      'key_not_found',
    );
  }

  return resolved;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if config is a built-in provider config.
 */
export function isBuiltinConfig(config: AgentLlmConfig): config is AgentLlmBuiltinConfig {
  if (typeof config !== 'object' || config === null) return false;
  const obj = config as unknown as Record<string, unknown>;
  return (
    'provider' in obj &&
    typeof obj['provider'] === 'string' &&
    ['openai', 'anthropic', 'google', 'mistral', 'groq'].includes(obj['provider'])
  );
}

/**
 * Check if config is a direct adapter config.
 */
export function isAdapterConfig(config: AgentLlmConfig): config is AgentLlmAdapterConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'adapter' in config &&
    (typeof config.adapter === 'object' || typeof config.adapter === 'function')
  );
}

/**
 * Check if config is a DI token.
 */
export function isTokenConfig(config: AgentLlmConfig): config is symbol {
  return typeof config === 'symbol';
}

/**
 * Check if value is an AgentLlmAdapter instance.
 */
export function isAdapterInstance(value: unknown): value is AgentLlmAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'completion' in value &&
    typeof (value as Record<string, unknown>)['completion'] === 'function'
  );
}

// ============================================================================
// Adapter Factory
// ============================================================================

/**
 * Options for creating an LLM adapter.
 */
export interface CreateAdapterOptions {
  /**
   * Configuration resolver for WithConfig values.
   */
  configResolver?: ConfigResolver;

  /**
   * Provider resolver for DI token resolution.
   */
  providerResolver?: ProviderResolver;

  /**
   * Entity context for auto-fallback resolution.
   * When provided, WithConfig values without explicit fallbacks will
   * automatically try entity-specific paths first.
   *
   * @example
   * ```typescript
   * entityContext: {
   *   entityType: 'agents',
   *   entityName: 'research-agent',
   * }
   * // For openaiKey, tries: agents.research_agent.openaiKey → agents.openaiKey → openaiKey
   * ```
   */
  entityContext?: ConfigResolutionContext;
}

/**
 * Create an LLM adapter from configuration.
 *
 * FrontMCP uses LangChain as the standard adapter layer for all LLM providers.
 * This provides a consistent API, built-in retry logic, and streaming support.
 *
 * Supported configuration types:
 * - Provider shorthand (`{ provider: 'openai', model: 'gpt-4o', ... }`) - recommended
 * - Direct LangChainAdapter instance (`{ adapter: new LangChainAdapter(...) }`)
 * - Factory function (`{ adapter: (providers) => new LangChainAdapter(...) }`)
 * - DI token (`LLM_ADAPTER` symbol)
 *
 * @example Provider shorthand (recommended)
 * ```typescript
 * const adapter = createAdapter({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   apiKey: { env: 'OPENAI_API_KEY' },
 * });
 * ```
 *
 * @example Direct LangChain adapter
 * ```typescript
 * import { ChatOpenAI } from '@langchain/openai';
 *
 * const adapter = createAdapter({
 *   adapter: new LangChainAdapter({
 *     model: new ChatOpenAI({ model: 'gpt-4o' }),
 *   }),
 * });
 * ```
 */
export function createAdapter(config: AgentLlmConfig, options: CreateAdapterOptions = {}): AgentLlmAdapter {
  const { configResolver, providerResolver, entityContext } = options;

  // Handle DI token
  if (isTokenConfig(config)) {
    if (!providerResolver) {
      throw new LlmAdapterError('ProviderResolver required to resolve LLM adapter token', 'config', 'no_resolver');
    }
    const adapter = providerResolver.get<AgentLlmAdapter>(config);
    if (!adapter) {
      throw new LlmAdapterError('LLM adapter token not found in providers', 'config', 'token_not_found');
    }
    return adapter;
  }

  // Handle direct adapter instance or factory
  if (isAdapterConfig(config)) {
    if (typeof config.adapter === 'function') {
      // Factory function - call with provider resolver
      const result = config.adapter(providerResolver);
      return result as AgentLlmAdapter;
    }
    // Direct adapter instance
    return config.adapter as AgentLlmAdapter;
  }

  // Handle built-in adapter config
  if (isBuiltinConfig(config)) {
    return createBuiltinAdapter(config, configResolver, entityContext);
  }

  // Check if it's a direct adapter instance passed without wrapper
  if (isAdapterInstance(config)) {
    return config;
  }

  throw new LlmAdapterError(
    'Invalid LLM configuration. Expected built-in config, adapter instance, factory, or DI token.',
    'config',
    'invalid_config',
  );
}

/**
 * Create a built-in adapter from provider configuration.
 *
 * Automatically creates the appropriate LangChain adapter based on the provider.
 *
 * @example
 * ```typescript
 * @Agent({
 *   name: 'my-agent',
 *   llm: {
 *     provider: 'openai',
 *     model: 'gpt-4o',
 *     apiKey: { env: 'OPENAI_API_KEY' },
 *   },
 * })
 * ```
 */
function createBuiltinAdapter(
  config: AgentLlmBuiltinConfig,
  configResolver?: ConfigResolver,
  entityContext?: ConfigResolutionContext,
): AgentLlmAdapter {
  // Extract provider from the discriminated union
  const obj = config as unknown as Record<string, unknown>;
  const provider = obj['provider'] as string;
  const model = resolveStringValue(config.model as string | WithConfig<string>, configResolver, entityContext);
  const apiKey = resolveApiKey(config.apiKey, configResolver, entityContext);
  const baseUrl = config.baseUrl
    ? resolveStringValue(config.baseUrl as string | WithConfig<string>, configResolver, entityContext)
    : undefined;
  const { temperature, maxTokens } = config;

  return createProviderAdapterSync({
    provider: provider as 'openai' | 'anthropic' | 'google' | 'mistral' | 'groq',
    model,
    apiKey,
    baseUrl,
    temperature,
    maxTokens,
  });
}
