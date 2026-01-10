import { z } from 'zod';
import { Provider, ProviderScope } from '../../../common';
import { DottedPath, PathValue } from '../../../common/providers/base-config.provider';

/**
 * Error thrown when a required config key is missing.
 */
export class ConfigMissingError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Required configuration "${key}" is not defined`);
    this.name = 'ConfigMissingError';
    this.key = key;
  }
}

/**
 * Error thrown when config validation fails.
 */
export class ConfigValidationError extends Error {
  readonly zodError: z.ZodError;

  constructor(message: string, zodError: z.ZodError) {
    const formattedErrors = zodError.issues.map((e) => `  - ${e.path.join('.')}: ${e.message}`).join('\n');
    super(`${message}:\n${formattedErrors}`);
    this.name = 'ConfigValidationError';
    this.zodError = zodError;
  }
}

/**
 * Type-safe configuration service with convict-like nested path access.
 *
 * Provides typed access to configuration values using dot notation paths.
 * When used with a Zod schema, provides full type inference and autocomplete.
 *
 * @example
 * ```typescript
 * const schema = z.object({
 *   database: z.object({
 *     url: z.string(),
 *     port: z.number().default(5432),
 *   }),
 *   debug: z.boolean().default(false),
 * });
 *
 * type Config = z.infer<typeof schema>;
 * const config = new ConfigService<Config>(loadedConfig);
 *
 * // Full autocomplete and type inference
 * config.get('database.url');     // string | undefined
 * config.get('database.port');    // number | undefined
 * config.getOrThrow('debug');     // boolean
 * ```
 */
@Provider({
  name: 'provider:config:service',
  description: 'Type-safe configuration service with nested path access',
  scope: ProviderScope.GLOBAL,
})
export class ConfigService<TConfig extends object = Record<string, string>> {
  private readonly config: TConfig;

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Get a configuration value using dot notation path.
   * Returns undefined if not found.
   *
   * @param path - Dot notation path (e.g., 'database.url')
   * @returns Value at path or undefined
   *
   * @example
   * config.get('database.url')     // string | undefined
   * config.get('server.port', 3000) // number
   */
  get<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P> | undefined;
  get<P extends DottedPath<TConfig>>(path: P, defaultValue: PathValue<TConfig, P>): PathValue<TConfig, P>;
  get<P extends DottedPath<TConfig>>(path: P, defaultValue?: PathValue<TConfig, P>): PathValue<TConfig, P> | undefined {
    const keys = (path as string).split('.');
    let result: unknown = this.config;

    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = (result as Record<string, unknown>)[key];
      } else {
        return defaultValue;
      }
    }

    return (result ?? defaultValue) as PathValue<TConfig, P>;
  }

  /**
   * Get a required configuration value. Throws if not found.
   *
   * @param path - Dot notation path (e.g., 'database.url')
   * @returns Value at path
   * @throws ConfigMissingError if not defined
   *
   * @example
   * config.getOrThrow('database.url') // string (throws if missing)
   */
  getOrThrow<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P> {
    const value = this.get(path);
    if (value === undefined) {
      throw new ConfigMissingError(path as string);
    }
    return value;
  }

  /**
   * Alias for getOrThrow.
   */
  getRequired<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P> {
    return this.getOrThrow(path);
  }

  /**
   * Check if a configuration path exists and has a value.
   *
   * @param path - Dot notation path (e.g., 'database.url')
   * @returns True if path exists and has a defined value
   */
  has(path: string): boolean {
    const keys = path.split('.');
    let result: unknown = this.config;

    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = (result as Record<string, unknown>)[key];
      } else {
        return false;
      }
    }

    return result !== undefined;
  }

  /**
   * Get the entire configuration object.
   */
  getAll(): TConfig {
    return this.config;
  }

  /**
   * Get the parsed configuration with a specific type.
   * Useful when you need to cast to a known type.
   */
  getParsed<T = TConfig>(): T {
    return this.config as unknown as T;
  }

  /**
   * Get a number value from configuration.
   * Parses string values to numbers if needed.
   *
   * @param path - Dot notation path
   * @param defaultValue - Default value if not found or not a number
   * @returns Number value or NaN
   */
  getNumber(path: string, defaultValue?: number): number {
    const value = this.get(path as DottedPath<TConfig>);
    if (value === undefined) {
      return defaultValue ?? NaN;
    }
    if (typeof value === 'number') {
      return value;
    }
    const num = Number(value);
    return isNaN(num) ? defaultValue ?? NaN : num;
  }

  /**
   * Get a boolean value from configuration.
   * Parses string values: 'true', '1', 'yes', 'on' -> true (case-insensitive)
   *
   * @param path - Dot notation path
   * @param defaultValue - Default value if not found
   * @returns Boolean value
   */
  getBoolean(path: string, defaultValue?: boolean): boolean {
    const value = this.get(path as DottedPath<TConfig>);
    if (value === undefined) {
      return defaultValue ?? false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    const str = String(value).toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(str);
  }
}
