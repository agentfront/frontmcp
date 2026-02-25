/**
 * Base type interfaces for dependency injection.
 *
 * These types define the core abstractions for DI tokens and class references.
 */

/**
 * Constructor type for a concrete class that produces instances of T.
 *
 * Useful anywhere a factory/DI container expects a class reference that can be
 * `new`-ed. For example: `getProvider(UserRepo as Type<UserRepo>)`.
 */
export interface Type<T = unknown> extends Function {
  new (...args: any[]): T;
}

/**
 * Function type that returns T or Promise<T>.
 * Used for factory functions in DI.
 */
export type FuncType<T> = (...args: any[]) => T | Promise<T>;

/**
 * Partial record mapping stage names to arrays of types.
 * Used for multi-stage initialization patterns.
 */
export type PartialStagesType<T extends string> = Partial<Record<T, Type[]>>;

/**
 * Empty Constructor type for a concrete class that produces instances of T.
 *
 * Useful for classes that can be instantiated without arguments.
 */
export interface CtorType<T = unknown> extends Function {
  new (): T;
}

/**
 * Constructor type with arbitrary arguments.
 */
export type Ctor<T> = new (...args: any[]) => T;

/**
 * Shape of an abstract class (or interface-like constructor) whose instances
 * cannot be created directly but still expose a prototype of T.
 *
 * This is handy when accepting references that may point at abstract bases
 * instead of concrete implementors.
 */
export interface Abstract<T> extends Function {
  prototype: T;
}

/**
 * A reference token that may be used to look up or identify a dependency.
 *
 * Typical usages:
 * - string | symbol: named tokens (e.g., provider IDs like "provider:redis").
 * - Type<T>: a concrete class constructor (can be instantiated).
 * - Abstract<T>: an abstract base reference (resolved to a concrete impl).
 * - Function: generic function references when needed.
 */
export type Reference<T = unknown> = string | symbol | Type<T> | Abstract<T> | Function;

/**
 * A DI token that can be either a class constructor or a logical reference.
 * This is the primary type for identifying dependencies in the DI system.
 */
// Note: `any` default is intentional - `unknown` breaks type inference in factory providers
export type Token<T = any> = Type<T> | Reference<T>;

/**
 * Provider definition using a class implementation.
 */
export interface ClassType<Provide> {
  provide: Reference<Provide>;
  useClass: Type<Provide>;
}

/**
 * Provider definition using a static value.
 */
export interface ValueType<Provide> {
  provide: Reference<Provide>;
  useValue: Provide;
}

/**
 * Abstract class token type for dependency references.
 */
// Note: `any` default is intentional - `unknown` breaks type inference in factory providers
export type ClassToken<T = any> = abstract new (...a: any) => T;

// Type utilities for resolving token types

/**
 * Resolve a single token to its instance type.
 */
type ResolveToken<T> =
  T extends ClassToken<infer R> ? R : T extends symbol & { readonly __di_type?: infer R } ? R : never;

/**
 * Resolve a tuple of tokens to their instance types.
 */
type ResolveTokens<Tokens extends readonly unknown[]> = {
  [K in keyof Tokens]: Tokens[K] extends Token<infer R> ? R : ResolveToken<Tokens[K]>;
};

/**
 * Strip readonly from tuple type for rest parameters.
 */
type Mutable<T extends readonly unknown[]> = { -readonly [K in keyof T]: T[K] };

/**
 * Factory provider definition with dependency injection.
 *
 * @example
 * ```typescript
 * const factory: FactoryType<Database, [Config, Logger]> = {
 *   provide: Database,
 *   inject: () => [Config, Logger] as const,
 *   useFactory: (config, logger) => new Database(config, logger),
 * };
 * ```
 */
export interface FactoryType<Provide, Tokens extends readonly (ClassToken | Token)[]> {
  provide: Reference<Provide>;
  inject: () => Tokens;
  useFactory: (...args: Mutable<ResolveTokens<Tokens>>) => Provide | Promise<Provide>;
}

/**
 * Utility type to make specific keys required.
 */
export type RequiredByKey<T, K extends keyof T> = T & Required<Omit<T, K>>;
