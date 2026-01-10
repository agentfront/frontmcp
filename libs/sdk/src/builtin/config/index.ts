/**
 * Built-in ConfigPlugin for environment variable management.
 *
 * Provides typed access to configuration with convict-style nested path support.
 * Loads from .env files, YAML config files, and validates with Zod schemas.
 *
 * @example
 * ```typescript
 * import { FrontMcp, App, ConfigPlugin } from '@frontmcp/sdk';
 * import { z } from 'zod';
 *
 * // Define configuration schema
 * const configSchema = z.object({
 *   database: z.object({
 *     url: z.string().describe('Database URL'),
 *     port: z.number().default(5432).describe('Database port'),
 *   }),
 *   debug: z.boolean().default(false),
 * });
 *
 * @FrontMcp({
 *   plugins: [
 *     ConfigPlugin.init({
 *       schema: configSchema,
 *       basePath: __dirname,
 *     }),
 *   ],
 * })
 * class MyServer {}
 *
 * // In tools:
 * class MyTool extends ToolContext {
 *   async execute(input) {
 *     // Typed access with dot notation
 *     const dbUrl = this.config.getOrThrow('database.url');
 *     const port = this.config.get('database.port', 5432);
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

// Main plugin export
export { default as ConfigPlugin } from './config.plugin';

// Types
export type { ConfigPluginOptions, ConfigPluginOptionsInput, ParsedEnvConfig } from './config.types';

// Service and errors
export { ConfigService, ConfigMissingError, ConfigValidationError } from './providers/config.service';

// Config loader
export { loadConfig, deepMerge } from './providers/config-loader';
export type { ConfigLoaderOptions } from './providers/config-loader';

// Env loader utilities
export {
  loadEnvFiles,
  parseEnvContent,
  parseEnvContentSync,
  populateProcessEnv,
  pathToEnvKey,
  setNestedValue,
  getNestedValue,
  extractSchemaPaths,
  mapEnvToNestedConfig,
} from './providers/env-loader';

// DI token (for advanced usage)
export { ConfigPluginConfigToken } from './config.symbols';

// Config resolver with context-aware fallbacks
export {
  ConfigEntityType,
  ConfigResolutionContext,
  ConfigResolver,
  normalizeNameForEnv,
  normalizePathSegment,
  generateFallbacks,
  generateEnvFallbacks,
  resolveWithFallbacks,
  createContextResolver,
  createDirectResolver,
} from './config-resolver';

// Helper functions
import { ConfigService } from './providers/config.service';

/**
 * Get the ConfigService from an execution context.
 * Alternative to `this.config` for explicit function-style access.
 *
 * @throws Error if ConfigPlugin is not installed
 */
export function getConfig<T extends { get: (token: unknown) => unknown }>(ctx: T): ConfigService {
  return ctx.get(ConfigService) as ConfigService;
}

/**
 * Try to get the ConfigService, returning undefined if not available.
 * Use this for graceful degradation when the plugin might not be installed.
 */
export function tryGetConfig<T extends { tryGet?: (token: unknown) => unknown }>(ctx: T): ConfigService | undefined {
  if (typeof ctx.tryGet === 'function') {
    return ctx.tryGet(ConfigService) as ConfigService | undefined;
  }
  return undefined;
}
