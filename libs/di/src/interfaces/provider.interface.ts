/**
 * Provider-related interfaces for dependency injection.
 */

import type { Type, Reference, Token, ClassType, ValueType, FactoryType, ClassToken } from './base.interface.js';
import type { ProviderMetadata } from '../metadata/provider.metadata.js';

/**
 * Base interface for all providers.
 * Providers are registered in the DI container and can be resolved by token.
 */
export interface ProviderInterface {
  /**
   * Initialize the provider after construction.
   * Called by the DI container if defined.
   */
  init?(): void | Promise<void>;
}

/**
 * Provider defined as a class with static metadata.
 * The class itself is used as both the token and implementation.
 */
export type ProviderClassTokenType<T = unknown> = Type<T> & {
  metadata?: ProviderMetadata;
};

/**
 * Provider using useClass pattern.
 */
export type ProviderClassType<T = unknown> = ClassType<T> & {
  metadata?: ProviderMetadata;
};

/**
 * Provider using useValue pattern.
 */
export type ProviderValueType<T = unknown> = ValueType<T> & {
  metadata?: ProviderMetadata;
};

/**
 * Provider using useFactory pattern.
 */
export type ProviderFactoryType<
  T = unknown,
  Tokens extends readonly (ClassToken | Token)[] = readonly Token[],
> = FactoryType<T, Tokens> & {
  metadata?: ProviderMetadata;
};

/**
 * Union of all provider type definitions.
 * This is the input type when registering providers with the container.
 */
export type ProviderType<T = unknown> =
  | ProviderClassTokenType<T>
  | ProviderClassType<T>
  | ProviderValueType<T>
  | ProviderFactoryType<T>;

/**
 * Async provider marker interface.
 * Providers implementing this interface use static `with()` for async initialization.
 */
export interface AsyncProvider<T = unknown> {
  /**
   * Static async factory method.
   * Called instead of constructor when @AsyncWith decorator is used.
   */
  with?(...deps: any[]): T | Promise<T>;
}
