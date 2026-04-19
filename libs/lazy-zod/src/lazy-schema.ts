import type { infer as zInfer, ZodTypeAny } from 'zod';

import { CHAIN_METHODS } from './factories';

/**
 * Branded symbol that identifies lazy schemas at runtime.
 * `isLazy(x)` checks for this; the Proxy's `get` trap reports it as `true`.
 */
export const LAZY_BRAND: unique symbol = Symbol.for('@frontmcp/lazy-zod.LazyZodSchema');

/**
 * Escape-hatch symbol. Accessing `proxy[LAZY_TARGET]` on a lazy schema
 * returns the underlying `LazyZodSchema` instance (bypassing the Proxy).
 * Used by `forceMaterialize` and in tests to assert on the real target.
 */
export const LAZY_TARGET: unique symbol = Symbol.for('@frontmcp/lazy-zod.LazyZodSchema.target');

const HOT_PATH_METHODS = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync']);

/**
 * Holds a memoized factory that builds a real zod schema on first call.
 * The Proxy in `wrapLazy` is what makes instances of this class behave
 * like the schema they eventually materialize to.
 */
export class LazyZodSchema {
  private _resolved: ZodTypeAny | undefined;

  constructor(private readonly _materialize: () => ZodTypeAny) {
    Object.defineProperty(this, LAZY_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /** Materialize (and memoize) the underlying real zod schema. */
  materialize(): ZodTypeAny {
    return this._resolved ?? (this._resolved = this._materialize());
  }

  /** True once the underlying schema has been constructed. */
  get isMaterialized(): boolean {
    return this._resolved !== undefined;
  }
}

/**
 * Wrap a `LazyZodSchema` in a Proxy that presents the full zod API surface:
 *  - `.parse / .safeParse / .parseAsync / .safeParseAsync` materialize,
 *    bind, and self-patch the bound method onto the underlying instance
 *    so subsequent calls skip all Proxy logic (validated at +0.2% overhead
 *    by the POC).
 *  - Methods in `CHAIN_METHODS` capture into a new child `LazyZodSchema`
 *    whose factory is `() => parent.materialize()[method](...args)`.
 *  - Everything else (`.shape`, `._def`, `isOptional()`, etc.) materializes
 *    and forwards. Functions are bound to the materialized schema.
 *  - `getPrototypeOf` forwards to the materialized schema so `instanceof`
 *    works (materializes on first check).
 */
export function wrapLazy(schema: LazyZodSchema): unknown {
  const proxy: unknown = new Proxy(schema, {
    get(target, key, _receiver) {
      // Brand check — zero cost, avoids materializing during `isLazy`
      if (key === LAZY_BRAND) return true;
      // Escape hatch — return the underlying LazyZodSchema instance
      if (key === LAZY_TARGET) return target;

      // Own-prop fast path — self-patched hot-path methods land here on
      // every call after the first. No function-creation, no materialize.
      if (typeof key !== 'symbol' && Object.prototype.hasOwnProperty.call(target, key)) {
        return (target as unknown as Record<string, unknown>)[key as string];
      }

      // Hot path — materialize, bind, self-patch, call.
      // Forward ALL arguments (zod's `parse` / `safeParse` accept optional
      // params objects like error maps); taking only `data` would drop them
      // on the cold path and make cold/warm calls behave differently.
      if (typeof key === 'string' && HOT_PATH_METHODS.has(key)) {
        return (...args: unknown[]) => {
          const real = target.materialize();
          const bound = (real as unknown as Record<string, (...a: unknown[]) => unknown>)[key].bind(real);
          Object.defineProperty(target, key, {
            value: bound,
            writable: true,
            configurable: true,
            enumerable: false,
          });
          return bound(...args);
        };
      }

      // Chainable — capture into a new lazy
      if (typeof key === 'string' && CHAIN_METHODS.has(key)) {
        return (...args: unknown[]) =>
          wrapLazy(
            new LazyZodSchema(() => {
              const real = target.materialize() as unknown as Record<string, (...a: unknown[]) => ZodTypeAny>;
              return real[key](...args);
            }),
          );
      }

      // Anything else — materialize and forward. Bind methods so callers
      // using `schema.method(...)` get the right `this`, but NOT constructors
      // or classes (binding turns them into "bound X" which breaks
      // `.constructor.name` identity checks downstream). `key === 'constructor'`
      // is the common case we have to protect; a broader heuristic covers
      // any function whose `prototype` has own properties (i.e. a class).
      const real = target.materialize() as unknown as Record<PropertyKey, unknown>;
      const val = real[key as PropertyKey];
      if (typeof val === 'function') {
        if (key === 'constructor') return val;
        const maybeCtor = val as { prototype?: object };
        if (
          typeof maybeCtor.prototype === 'object' &&
          maybeCtor.prototype !== null &&
          Object.getOwnPropertyNames(maybeCtor.prototype).length > 1
        ) {
          return val;
        }
        return (val as (...a: unknown[]) => unknown).bind(real);
      }
      return val;
    },

    has(target, key) {
      if (key === LAZY_BRAND) return true;
      if (typeof key === 'string' && (HOT_PATH_METHODS.has(key) || CHAIN_METHODS.has(key))) {
        return true;
      }
      return Reflect.has(target.materialize(), key);
    },

    getPrototypeOf(target) {
      return Object.getPrototypeOf(target.materialize());
    },
  });
  return proxy;
}

/**
 * Explicit factory-style lazy wrapper. Given a function that returns a
 * real zod schema, returns a drop-in replacement whose construction is
 * deferred until first `.parse()`.
 */
export function lazyZ<T extends ZodTypeAny>(factory: () => T): T {
  return wrapLazy(new LazyZodSchema(factory)) as T;
}

/**
 * Type helper mirroring `z.infer` for `lazyZ`-wrapped schemas.
 * Useful when the factory's return type is carried explicitly.
 */
export type InferLazy<L> = L extends ZodTypeAny ? zInfer<L> : never;
