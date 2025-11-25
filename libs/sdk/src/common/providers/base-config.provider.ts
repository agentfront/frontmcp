// file: libs/sdk/src/common/providers/base-config.provider.ts

/**
 * Type-safe dotted path builder for nested object access
 * Examples: 'vm.preset', 'embedding.strategy', 'directCalls.enabled'
 */
export type DottedPath<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? `${Prefix}${K}` | DottedPath<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

/**
 * Get the type at a dotted path
 */
export type PathValue<T, P extends string> = P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? PathValue<T[Key], Rest>
    : never
  : P extends keyof T
  ? T[P]
  : never;

/**
 * Base configuration provider with type-safe path lookup and convict-like API
 */
export abstract class BaseConfig<TConfig extends object> {
  protected readonly config: TConfig;

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Get the complete configuration object
   */
  getAll(): TConfig {
    return this.config;
  }

  /**
   * Get a value using dotted path notation (convict-like)
   * @example
   * config.get('vm.preset') // returns 'secure'
   * config.get('embedding.strategy') // returns 'tfidf'
   * config.get('directCalls.enabled') // returns true
   * config.get('vm.timeout', 5000) // returns value or 5000 if undefined
   */
  get<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P>;
  get<P extends DottedPath<TConfig>>(path: P, defaultValue: PathValue<TConfig, P>): PathValue<TConfig, P>;
  get<P extends DottedPath<TConfig>>(path: P, defaultValue?: PathValue<TConfig, P>): PathValue<TConfig, P> {
    const keys = (path as string).split('.');
    let result: any = this.config;

    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = result[key];
      } else {
        return defaultValue !== undefined ? defaultValue : (undefined as PathValue<TConfig, P>);
      }
    }

    const value = result as PathValue<TConfig, P>;
    return value !== undefined
      ? value
      : defaultValue !== undefined
      ? defaultValue
      : (undefined as PathValue<TConfig, P>);
  }

  /**
   * Check if a path exists in the configuration
   * @example
   * config.has('vm.preset') // returns true
   * config.has('nonexistent.path') // returns false
   */
  has(path: string): boolean {
    const keys = path.split('.');
    let result: any = this.config;

    for (const key of keys) {
      if (result && typeof result === 'object' && key in result) {
        result = result[key];
      } else {
        return false;
      }
    }

    return result !== undefined;
  }

  /**
   * Get a value with a default fallback
   * @example
   * config.getOrDefault('vm.timeout', 5000)
   */
  getOrDefault<P extends DottedPath<TConfig>>(path: P, defaultValue: PathValue<TConfig, P>): PathValue<TConfig, P> {
    const value = this.get(path);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Get a required value (throws if undefined)
   * @example
   * config.getRequired('vm.preset')
   * config.getOrThrow('vm.preset')
   */
  getRequired<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P> {
    const value = this.get(path);
    if (value === undefined) {
      throw new Error(`Required configuration path "${path}" is undefined`);
    }
    return value;
  }

  /**
   * Alias for getRequired - Get a required value (throws if undefined)
   * @example
   * config.getOrThrow('vm.preset')
   */
  getOrThrow<P extends DottedPath<TConfig>>(path: P): PathValue<TConfig, P> {
    return this.getRequired(path);
  }

  /**
   * Get a nested object at a path
   * @example
   * config.getSection('vm') // returns entire vm config
   */
  getSection<K extends keyof TConfig>(section: K): TConfig[K] {
    return this.config[section];
  }

  /**
   * Check if the configuration matches a specific value at a path
   * @example
   * config.matches('vm.preset', 'secure') // returns true/false
   */
  matches<P extends DottedPath<TConfig>>(path: P, value: PathValue<TConfig, P>): boolean {
    return this.get(path) === value;
  }

  /**
   * Get multiple values at once
   * @example
   * config.getMany(['vm.preset', 'embedding.strategy', 'topK'])
   */
  getMany<P extends DottedPath<TConfig>>(paths: P[]): Record<P, PathValue<TConfig, P>> {
    const result = {} as Record<P, PathValue<TConfig, P>>;
    for (const path of paths) {
      result[path] = this.get(path);
    }
    return result;
  }

  /**
   * Convert configuration to JSON
   */
  toJSON(): TConfig {
    return this.config;
  }

  /**
   * Convert configuration to string
   */
  toString(): string {
    return JSON.stringify(this.config, null, 2);
  }
}
