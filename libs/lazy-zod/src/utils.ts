import type { ZodTypeAny } from 'zod';

import { LAZY_BRAND, LAZY_TARGET, type LazyZodSchema } from './lazy-schema';

/**
 * Runtime check: returns true if the given value is a lazy-zod schema
 * (either from the `z` Proxy or from `lazyZ(...)`).
 */
export function isLazy(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
  return (value as Record<symbol, unknown>)[LAZY_BRAND] === true;
}

/**
 * Materialize a lazy schema and return the underlying real zod schema.
 * If `schema` is not lazy, it is returned as-is.
 *
 * Use this before handing a schema to third-party code that inspects
 * internals (e.g. `toJSONSchema`, prototype chain walks) and needs a
 * plain zod object rather than the lazy Proxy.
 */
export function forceMaterialize<T extends ZodTypeAny>(schema: T): T {
  if (!isLazy(schema)) return schema;
  const target = (schema as unknown as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
  return target.materialize() as T;
}
