/**
 * Context-aware configuration resolution with automatic fallbacks.
 *
 * Provides 3-level fallback resolution for entity configuration:
 * 1. Entity-specific: `{entityType}.{entityName}.{key}`
 * 2. Entity-type default: `{entityType}.{key}`
 * 3. Global default: `{key}`
 *
 * @example
 * ```typescript
 * // For agent 'research-agent' looking for 'openaiKey':
 * // Tries: agents.research-agent.openaiKey → agents.openaiKey → openaiKey
 *
 * const resolver = createContextResolver(configService, {
 *   entityType: 'agents',
 *   entityName: 'research-agent',
 * });
 *
 * const apiKey = resolver.get('openaiKey');
 * ```
 *
 * @packageDocumentation
 */

import type { ConfigService } from './providers/config.service';

// ============================================================================
// Types
// ============================================================================

/**
 * Entity types that support context-aware config resolution.
 */
export type ConfigEntityType = 'agents' | 'plugins' | 'adapters';

/**
 * Context for resolving configuration with fallbacks.
 */
export interface ConfigResolutionContext {
  /**
   * Type of entity (agents, plugins, adapters).
   */
  entityType: ConfigEntityType;

  /**
   * Name of the specific entity.
   */
  entityName: string;
}

/**
 * Interface for resolving configuration values.
 * Used by adapter factory and other components that need config access.
 */
export interface ConfigResolver {
  /**
   * Get a configuration value by path.
   * Throws if not found.
   *
   * @param path - Dot-notation path (e.g., 'openaiKey')
   * @returns The resolved value
   * @throws Error if config key not found
   */
  get<T = unknown>(path: string): T;

  /**
   * Try to get a configuration value, returning undefined if not found.
   *
   * @param path - Dot-notation path
   * @returns The resolved value or undefined
   */
  tryGet<T = unknown>(path: string): T | undefined;
}

// ============================================================================
// Name Normalization
// ============================================================================

/**
 * Normalize an entity name for environment variable lookup.
 * Converts to uppercase and replaces non-alphanumeric characters with underscores.
 *
 * @example
 * ```typescript
 * normalizeNameForEnv('research-agent') // 'RESEARCH_AGENT'
 * normalizeNameForEnv('my agent')       // 'MY_AGENT'
 * normalizeNameForEnv('plugin.name')    // 'PLUGIN_NAME'
 * ```
 */
export function normalizeNameForEnv(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Normalize a config path for nested object lookup.
 * Replaces non-alphanumeric characters (except dots) with underscores in each segment.
 *
 * @example
 * ```typescript
 * normalizePathSegment('research-agent') // 'research_agent'
 * ```
 */
export function normalizePathSegment(segment: string): string {
  return segment.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// ============================================================================
// Fallback Generation
// ============================================================================

/**
 * Generate fallback paths for a config key based on entity context.
 *
 * Creates a 3-level fallback chain:
 * 1. `{entityType}.{entityName}.{key}` - Entity-specific
 * 2. `{entityType}.{key}` - Entity-type default
 * 3. `{key}` - Global default
 *
 * @param key - The config key to look up
 * @param context - Entity context (type and name)
 * @returns Array of paths to try in order
 *
 * @example
 * ```typescript
 * generateFallbacks('openaiKey', { entityType: 'agents', entityName: 'research-agent' })
 * // Returns: ['agents.research_agent.openaiKey', 'agents.openaiKey', 'openaiKey']
 * ```
 */
export function generateFallbacks(key: string, context: ConfigResolutionContext): string[] {
  const { entityType, entityName } = context;
  const normalizedName = normalizePathSegment(entityName);

  return [
    `${entityType}.${normalizedName}.${key}`, // agents.research_agent.openaiKey
    `${entityType}.${key}`, // agents.openaiKey
    key, // openaiKey
  ];
}

/**
 * Generate environment variable names for fallback lookup.
 *
 * Creates environment variable names matching the fallback paths:
 * 1. `{ENTITY_TYPE}_{ENTITY_NAME}_{KEY}` - Entity-specific
 * 2. `{ENTITY_TYPE}_{KEY}` - Entity-type default
 * 3. `{KEY}` - Global default
 *
 * Note: Keys are converted to uppercase with non-alphanumeric chars replaced by underscores.
 * CamelCase keys like 'openaiKey' become 'OPENAIKEY' (no word-boundary detection).
 *
 * @param key - The config key
 * @param context - Entity context
 * @returns Array of env var names to try
 *
 * @example
 * ```typescript
 * generateEnvFallbacks('openaiKey', { entityType: 'agents', entityName: 'research-agent' })
 * // Returns: ['AGENTS_RESEARCH_AGENT_OPENAIKEY', 'AGENTS_OPENAIKEY', 'OPENAIKEY']
 * ```
 */
export function generateEnvFallbacks(key: string, context: ConfigResolutionContext): string[] {
  const { entityType, entityName } = context;
  const normalizedType = normalizeNameForEnv(entityType);
  const normalizedName = normalizeNameForEnv(entityName);
  const normalizedKey = normalizeNameForEnv(key);

  return [
    `${normalizedType}_${normalizedName}_${normalizedKey}`, // e.g., AGENTS_RESEARCH_AGENT_OPENAIKEY (via normalizeNameForEnv)
    `${normalizedType}_${normalizedKey}`, // e.g., AGENTS_OPENAIKEY (via normalizeNameForEnv)
    normalizedKey, // e.g., OPENAIKEY (via normalizeNameForEnv)
  ];
}

// ============================================================================
// Resolution Functions
// ============================================================================

/**
 * Resolve a config value with fallbacks.
 * Tries each path in order until a value is found.
 *
 * @param config - ConfigService instance
 * @param paths - Paths to try in order
 * @returns The first found value, or undefined if none found
 */
export function resolveWithFallbacks<T>(
  config: ConfigService<Record<string, unknown>>,
  paths: string[],
): T | undefined {
  for (const path of paths) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = config.get(path as any);
    if (value !== undefined) {
      return value as T;
    }
  }
  return undefined;
}

/**
 * Create a ConfigResolver that uses entity context for auto-fallbacks.
 *
 * @param config - ConfigService instance
 * @param context - Entity context for generating fallbacks
 * @returns ConfigResolver with fallback support
 *
 * @example
 * ```typescript
 * const resolver = createContextResolver(configService, {
 *   entityType: 'agents',
 *   entityName: 'research-agent',
 * });
 *
 * // Tries: agents.research_agent.openaiKey → agents.openaiKey → openaiKey
 * const apiKey = resolver.get('openaiKey');
 * ```
 */
export function createContextResolver(
  config: ConfigService<Record<string, unknown>>,
  context: ConfigResolutionContext,
): ConfigResolver {
  return {
    get<T>(path: string): T {
      const fallbacks = generateFallbacks(path, context);
      const value = resolveWithFallbacks<T>(config, fallbacks);
      if (value === undefined) {
        throw new Error(`Config "${path}" not found. Tried: ${fallbacks.join(', ')}`);
      }
      return value;
    },
    tryGet<T>(path: string): T | undefined {
      const fallbacks = generateFallbacks(path, context);
      return resolveWithFallbacks<T>(config, fallbacks);
    },
  };
}

/**
 * Create a simple ConfigResolver without fallbacks (direct lookup only).
 *
 * @param config - ConfigService instance
 * @returns ConfigResolver with direct lookup
 */
export function createDirectResolver(config: ConfigService<Record<string, unknown>>): ConfigResolver {
  return {
    get<T>(path: string): T {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = config.get(path as any);
      if (value === undefined) {
        throw new Error(`Config "${path}" not found`);
      }
      return value as T;
    },
    tryGet<T>(path: string): T | undefined {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return config.get(path as any) as T | undefined;
    },
  };
}
