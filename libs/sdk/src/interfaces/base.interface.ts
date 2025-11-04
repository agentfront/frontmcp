/**
 * Constructor type for a concrete class that produces instances of T.
 *
 * Useful anywhere a factory/DI container expects a class reference that can be
 * `new`-ed. For example: `getProvider(UserRepo as Type<UserRepo>)`.
 */
export interface Type<T = unknown> extends Function {
  new(...args: any[]): T;
}

/**
 * Constructor type for a concrete class that produces instances of T.
 *
 * Useful anywhere a factory/DI container expects a class reference that can be
 * `new`-ed. For example: `getProvider(UserRepo as Type<UserRepo>)`.
 */
export type FuncType<T> = (...args: any[]) => any | Promise<any>;


export type PartialStagesType<T extends string> = Partial<Record<T, Type[]>>;

/**
 * Empty Constructor type for a concrete class that produces instances of T.
 *
 * Useful anywhere a factory/DI container expects a class reference that can be
 * `new`-ed. For example: `getProvider(UserRepo as Type<UserRepo>)`.
 */
export interface CtorType<T = unknown> extends Function {
  new(): T;
}

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

/** A DI token that can be either a class constructor or a logical reference. */
export type Token<T = any> = Type<T> | Reference<T>;


export interface ClassType<Provide> {
  provide: Reference<Provide>;
  useClass: Type<Provide>;
}

export interface ValueType<Provide> {
  provide: Reference<Provide>;
  useValue: Provide;
}

/** Map a tuple of tokens to a tuple of their instance types (order preserved). */

export type ClassToken<T = any> = abstract new (...a: any) => T;
// Branded symbol token that carries the payload type T

// export type Resolve<Tokens extends readonly Token[]> = {
//   [K in keyof Tokens]: Tokens[K] extends Token<infer R> ? R : never;
// };

/** 2) Map tokens -> runtime parameter types **/
type ResolveToken<T> =
  T extends ClassToken<infer R> ? R
  : T extends symbol & { readonly __di_type?: infer R } ? R
  : never;

type ResolveTokens<Tokens extends readonly unknown[]> = {
  [K in keyof Tokens]: Tokens[K] extends Token<infer R> ? R : ResolveToken<Tokens[K]>;
};

// Rest parameters can't be readonly tuples; strip readonly.
type Mutable<T extends readonly unknown[]> = { -readonly [K in keyof T]: T[K] };

/** 3) FactoryType with correct useFactory shape **/
export interface FactoryType<Provide, Tokens extends readonly (ClassToken | Token)[]> {
  provide: Reference<Provide>;
  inject: () => Tokens;
  useFactory: (...args: Mutable<ResolveTokens<Tokens>>) => Provide | Promise<Provide>;
}



export type RequiredByKey<T, K extends keyof T> = T & Required<Omit<T, K>>;
