/**
 * Token utilities for dependency injection.
 *
 * These utilities help with token resolution, type checking, and
 * dependency discovery from class metadata.
 */

import type { Token, Type } from '../interfaces/base.interface.js';
import { DESIGN_PARAMTYPES, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';
import { getMetadata, hasAsyncWith } from './metadata.utils.js';

/**
 * Get a human-readable name for a token.
 *
 * @param t - The token to get the name for
 * @returns A string representation of the token
 */
export const tokenName = (t: Token): string =>
  typeof t === 'function' && !!(t as any).prototype ? (t as any).name : ((t as any)?.name ?? '[ref]');

/**
 * Check if a value is a class constructor.
 *
 * @param x - The value to check
 * @returns True if x is a class constructor
 */
export const isClass = (x: any): x is Type => typeof x === 'function' && !!x.prototype;

/**
 * Check if a value is a Promise.
 *
 * @param v - The value to check
 * @returns True if v is a Promise
 */
export const isPromise = (v: any): v is Promise<any> => !!v && typeof v.then === 'function';

/**
 * Get async-with dependency tokens from a class.
 *
 * If a class is decorated with @AsyncWith, this returns the token array
 * that should be resolved and passed to the static `with()` method.
 *
 * @param klass - The class to get tokens from
 * @returns Array of dependency tokens, or null if not decorated
 */
export function getAsyncWithTokens(klass: Type<any>): Type<any>[] | null {
  const resolver = getMetadata<null | (() => any[])>(META_ASYNC_WITH_TOKENS, klass) as null | (() => any[]);
  if (!resolver) return null;
  const arr = resolver() ?? [];
  return arr.filter(isClass) as Type<any>[];
}

/**
 * Read parameter types for static with(...) method.
 *
 * This function is TDZ-friendly and will use the @AsyncWith token array
 * if available, falling back to design:paramtypes metadata.
 *
 * @param klass - The class to read parameter types from
 * @param forWhat - Whether this is for 'discovery' or 'invocation' phase
 * @returns Array of dependency types
 * @throws If parameter types cannot be determined
 */
export function readWithParamTypes(klass: Type, forWhat: 'discovery' | 'invocation'): Type[] {
  const lazy = getAsyncWithTokens(klass);
  if (lazy) return lazy;

  const meta = getMetadata<unknown[]>(DESIGN_PARAMTYPES, klass, 'with') as unknown[] | undefined;
  if (meta === undefined) {
    const where = `${klass.name}.with(...)`;
    const hint =
      "Add @AsyncWith(() => [DepA, DepB]) to lazily declare deps, or decorate 'with' so TypeScript emits design:paramtypes.";
    throw new Error(`Cannot discover ${forWhat} deps for ${where}. ${hint}`);
  }

  const tdzIdx = meta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    const where = `${klass.name}.with(...)`;
    throw new Error(
      `Unresolved dependency at param #${tdzIdx} in ${where} (ESM circular import / TDZ).\n` +
        `Fix: add @AsyncWith(() => [/* deps */]) on ${klass.name} to avoid TDZ, or refactor the import cycle.`,
    );
  }

  return (meta as any[]).filter(isClass) as Type[];
}

/**
 * Discover dependencies for a CLASS token or concrete Type.
 *
 * For classes with @AsyncWith, reads from the static `with()` method.
 * Otherwise, reads constructor parameter types.
 *
 * @param klass - The class to discover dependencies for
 * @param phase - Whether this is 'discovery' or 'invocation' phase
 * @returns Array of dependency types
 * @throws If dependencies cannot be determined (TDZ issues, missing metadata)
 */
export function depsOfClass(klass: Type, phase: 'discovery' | 'invocation'): Type[] {
  if (hasAsyncWith(klass)) return readWithParamTypes(klass, phase);

  const ctorMeta: unknown[] = getMetadata<unknown[]>(DESIGN_PARAMTYPES, klass) ?? [];
  const tdzIdx = ctorMeta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    throw new Error(
      `Unresolved constructor dependency in ${klass.name} at param #${tdzIdx} (ESM circular import / TDZ).\n` +
        `Fix: convert this provider to @AsyncWith(() => [/* deps */]) and use a static with(...), or break the import cycle.`,
    );
  }
  return (ctorMeta as any[]).filter(isClass) as Type[];
}

/**
 * Discover dependencies for a function token.
 *
 * Reads design:paramtypes metadata, skipping the first parameter
 * (which is typically the input argument, not a dependency).
 *
 * @param fn - The function to discover dependencies for
 * @param phase - Whether this is 'discovery' or 'invocation' phase
 * @returns Array of dependency types
 * @throws If dependencies cannot be determined
 */
export function depsOfFunc(fn: (...args: any[]) => any | Promise<any>, phase: 'discovery' | 'invocation'): Type[] {
  const [_ignoreInput, ...fnMeta]: unknown[] = getMetadata<unknown[]>(DESIGN_PARAMTYPES, fn) ?? [];
  const tdzIdx = fnMeta.findIndex((t) => t === undefined);
  if (tdzIdx !== -1) {
    throw new Error(`Unresolved function dependency in ${fn.name} at param #${tdzIdx} (ESM circular import / TDZ).\n`);
  }
  return (fnMeta as any[]).filter(isClass) as Type[];
}
