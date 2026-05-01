import { z as realZ } from 'zod';

import { LAZY_TARGET, lazyZ, LazyZodSchema, wrapLazy } from '../lazy-schema';
import { z } from '../lazy-z';
import { forceMaterialize } from '../utils';

describe('forceMaterialize - nested lazy structures', () => {
  it('materializes nested lazy schemas inside object shape', () => {
    const inner = z.object({ a: z.string() });
    const outer = z.object({ inner });
    const real = forceMaterialize(outer);
    // Nested lazy was unwrapped during deep traversal — schema is usable
    expect(real.parse({ inner: { a: 'x' } })).toEqual({ inner: { a: 'x' } });
  });

  it('materializes lazy elements inside an array', () => {
    const elem = z.object({ a: z.string() });
    const arr = z.array(elem);
    const real = forceMaterialize(arr);
    expect(real.parse([{ a: 'x' }])).toEqual([{ a: 'x' }]);
  });

  it('materializes lazy elements inside union options', () => {
    const u = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    const real = forceMaterialize(u);
    expect(real.parse({ a: 'x' })).toEqual({ a: 'x' });
    expect(real.parse({ b: 1 })).toEqual({ b: 1 });
  });

  it('materializes lazy nested in intersection (left/right)', () => {
    const i = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
    const real = forceMaterialize(i);
    expect(real.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
  });

  it('materializes lazy nested in record (keyType/valueType)', () => {
    const r = z.record(z.string(), z.object({ a: z.string() }));
    const real = forceMaterialize(r);
    expect(real.parse({ k: { a: 'v' } })).toEqual({ k: { a: 'v' } });
  });

  it('materializes lazy nested in tuple items', () => {
    const t = z.tuple([z.object({ a: z.string() }), z.object({ b: z.number() })]);
    const real = forceMaterialize(t);
    expect(real.parse([{ a: 'x' }, { b: 1 }])).toEqual([{ a: 'x' }, { b: 1 }]);
  });

  it('materializes innerType (e.g. ZodOptional)', () => {
    const s = z.object({ a: z.string() }).optional();
    const real = forceMaterialize(s);
    expect(real.parse(undefined)).toBeUndefined();
    expect(real.parse({ a: 'x' })).toEqual({ a: 'x' });
  });

  it('materializes deeply nested combinations', () => {
    const deep = z.object({
      list: z.array(z.union([z.object({ a: z.string() }), z.object({ b: z.number() })])),
    });
    const real = forceMaterialize(deep);
    expect(real.parse({ list: [{ a: 'x' }, { b: 1 }] })).toEqual({ list: [{ a: 'x' }, { b: 1 }] });
  });

  it('handles a circular reference safely (uses WeakSet seen guard)', () => {
    const real = realZ.object({ a: realZ.string() });
    const def = (real as unknown as { _def: { shape: () => Record<string, unknown> } })._def;
    // Inject a self-reference into the shape so deepMaterialize would loop without `seen`
    const shape =
      typeof def.shape === 'function'
        ? (def.shape as () => Record<string, unknown>)()
        : (def.shape as unknown as Record<string, unknown>);
    shape.self = real; // cycle: real → shape.self → real
    expect(() => forceMaterialize(real)).not.toThrow();
  });

  it('returns primitive values unchanged from deep traversal', () => {
    expect(forceMaterialize(realZ.string())).toBeInstanceOf(realZ.ZodString);
  });

  it('handles a shape that is a plain object (not a getter function)', () => {
    // Sanity: builds an object schema and materializes — covers the
    // `typeof rawShape !== 'function'` branch in deepMaterialize.
    const real = forceMaterialize(z.object({ a: z.string(), b: z.number() }));
    expect(real.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
  });
});

describe('LazyZodSchema chain method materialization', () => {
  it('chained schemas materialize through the inner closure', () => {
    const factory = jest.fn(() => realZ.object({ a: realZ.string() }));
    const base = lazyZ(factory);
    // Chain twice — neither should materialize the base
    const chained = (base as unknown as { optional: () => { nullable: () => { parse: (d: unknown) => unknown } } })
      .optional()
      .nullable();
    expect(factory).toHaveBeenCalledTimes(0);
    // Now parse — triggers the chained closure, which materializes the base
    expect(chained.parse(null)).toBeNull();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('chain method args are forwarded to the materialized real method', () => {
    const factory = jest.fn(() => realZ.string());
    const base = lazyZ(factory);
    const minLen = (base as unknown as { min: (n: number) => { parse: (d: unknown) => unknown } }).min(3);
    expect(() => minLen.parse('hi')).toThrow();
    expect(minLen.parse('hello')).toBe('hello');
  });
});

describe('wrapLazy proxy edge cases', () => {
  it('returns LAZY_TARGET when accessed via the brand symbol', () => {
    const factory = () => realZ.string();
    const target = new LazyZodSchema(factory);
    const proxy = wrapLazy(target) as Record<symbol, unknown>;
    expect(proxy[LAZY_TARGET]).toBe(target);
  });

  it('has trap reports true for LAZY_BRAND and known method names', () => {
    const proxy = z.object({ a: z.string() });
    expect('parse' in proxy).toBe(true);
    expect('optional' in proxy).toBe(true);
  });

  it('has trap forwards unknown keys through to the materialized schema', () => {
    const proxy = z.object({ a: z.string() });
    expect('shape' in proxy).toBe(true);
  });

  it('getPrototypeOf forwards to the materialized prototype', () => {
    const proxy = z.object({ a: z.string() });
    expect(proxy).toBeInstanceOf(realZ.ZodObject);
  });

  it('returns constructor unbound (so .name and identity remain intact)', () => {
    const proxy = z.object({ a: z.string() });
    const ctor = (proxy as unknown as { constructor: unknown }).constructor;
    expect(typeof ctor).toBe('function');
    expect((ctor as { name: string }).name).toBe('ZodObject');
  });

  it('returns class-like values unbound (heuristic: prototype has own props)', () => {
    // ZodObject.prototype has many own props, so accessing a function-typed
    // member that IS a class falls through the class-detection guard and is
    // returned unbound.
    const proxy = z.object({ a: z.string() });
    // The constructor itself is a class — covers `key === 'constructor'`.
    const ctor = (proxy as unknown as Record<string, unknown>)['constructor'];
    expect(typeof ctor).toBe('function');
  });

  it('returns non-function values directly from materialized schema', () => {
    const proxy = z.object({ a: z.string() });
    const def = (proxy as unknown as { _def: unknown })._def;
    expect(typeof def).toBe('object');
  });

  it('binds plain method functions so `this` is the materialized schema', () => {
    const proxy = z.object({ a: z.string() });
    const isOptional = (proxy as unknown as { isOptional: () => boolean }).isOptional;
    expect(typeof isOptional).toBe('function');
    // Detached call works because the method is bound to the materialized
    expect(isOptional()).toBe(false);
  });
});
