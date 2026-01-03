/**
 * Token factory for creating type-safe DI tokens with configurable prefix.
 *
 * @example
 * ```typescript
 * // Create a factory with custom prefix
 * const tokens = createTokenFactory({ prefix: 'MyApp' });
 *
 * // Create typed tokens
 * const serviceToken = tokens.type('UserService');
 * // => Symbol('MyApp:type:UserService')
 *
 * const metaToken = tokens.meta('config');
 * // => Symbol('MyApp:meta:config')
 * ```
 */

export interface TokenFactoryOptions {
  /**
   * Prefix for generated token symbols.
   * @default 'DI'
   */
  prefix?: string;
}

export interface TokenFactory {
  /**
   * Create a type token for a service/provider.
   * @param name - The name of the type
   * @returns A unique symbol for the type
   */
  type: (name: string) => symbol;

  /**
   * Create a metadata token for storing/retrieving metadata.
   * @param name - The name of the metadata key
   * @returns A unique symbol for the metadata key
   */
  meta: (name: string) => symbol;
}

/**
 * Create a token factory with the given options.
 *
 * @param options - Factory configuration
 * @returns A token factory instance
 *
 * @example
 * ```typescript
 * const tokens = createTokenFactory({ prefix: 'FrontMcp' });
 * const userToken = tokens.type('UserService');
 * ```
 */
export function createTokenFactory(options: TokenFactoryOptions = {}): TokenFactory {
  const prefix = options.prefix ?? 'DI';

  return {
    type: (name: string) => Symbol(`${prefix}:type:${name}`),
    meta: (name: string) => Symbol(`${prefix}:meta:${name}`),
  };
}

/**
 * Default token factory instance with 'DI' prefix.
 * Use this for standalone DI usage without custom branding.
 */
export const DiTokens = createTokenFactory({ prefix: 'DI' });
