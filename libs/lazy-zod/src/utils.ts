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
 * Materialize a lazy schema and return the underlying real zod schema,
 * recursively materializing any lazy wrappers found in the schema tree
 * (object shapes, array elements, union options, etc.).
 *
 * Required before handing a schema to third-party code that walks zod's
 * internal `_def` properties and mutates them — `toJSONSchema`'s
 * processors write to `_def` nodes during traversal, and a lazy Proxy
 * in any nested position breaks those writes with
 * "TypeError: Cannot set properties of undefined".
 *
 * If `schema` is not lazy at the top level, the tree is still walked in
 * place so that nested lazy wrappers get resolved too.
 */
export function forceMaterialize<T extends ZodTypeAny>(schema: T): T {
  const seen = new WeakSet<object>();
  return deepMaterialize(schema, seen) as T;
}

function deepMaterialize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  let resolved: unknown = value;
  if ((value as Record<symbol, unknown>)[LAZY_BRAND] === true) {
    const target = (value as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
    resolved = target.materialize();
  }
  if (typeof resolved !== 'object' && typeof resolved !== 'function') return resolved;
  if (resolved === null) return resolved;
  if (seen.has(resolved as object)) return resolved;
  seen.add(resolved as object);

  const def = (resolved as { _def?: { [k: string]: unknown } })._def;
  if (def && typeof def === 'object') {
    // ZodObject: `shape` is either a plain object or a zero-arg getter.
    const rawShape = def['shape'];
    const shape = typeof rawShape === 'function' ? (rawShape as () => Record<string, unknown>).call(def) : rawShape;
    if (shape && typeof shape === 'object') {
      for (const k of Object.keys(shape as Record<string, unknown>)) {
        (shape as Record<string, unknown>)[k] = deepMaterialize((shape as Record<string, unknown>)[k], seen);
      }
    }
    const options = def['options'];
    if (Array.isArray(options)) {
      for (let i = 0; i < options.length; i++) options[i] = deepMaterialize(options[i], seen);
    }
    if ('innerType' in def) def['innerType'] = deepMaterialize(def['innerType'], seen);
    if ('element' in def) def['element'] = deepMaterialize(def['element'], seen);
    if ('valueType' in def) def['valueType'] = deepMaterialize(def['valueType'], seen);
    if ('keyType' in def) def['keyType'] = deepMaterialize(def['keyType'], seen);
    if ('left' in def) def['left'] = deepMaterialize(def['left'], seen);
    if ('right' in def) def['right'] = deepMaterialize(def['right'], seen);
    const items = def['items'];
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) items[i] = deepMaterialize(items[i], seen);
    }
  }
  return resolved;
}
