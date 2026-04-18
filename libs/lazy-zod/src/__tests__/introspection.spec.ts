import { z as realZ } from 'zod';

import { LAZY_TARGET, LazyZodSchema } from '../lazy-schema';
import { z } from '../lazy-z';

describe('introspection (forces materialization)', () => {
  it('.shape on lazy ZodObject returns the real shape', () => {
    const s = z.object({ a: z.string(), b: z.number() });
    const shape = (s as unknown as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape).sort()).toEqual(['a', 'b']);
  });

  it('._def is the real zod _def', () => {
    const s = z.object({ a: z.string() });
    const def = (s as unknown as { _def: unknown })._def;
    expect(def).toBeDefined();
  });

  it('instanceof real zod classes works after materialization', () => {
    const obj = z.object({ a: z.string() });
    // Force materialization via .shape
    void (obj as unknown as { shape: unknown }).shape;
    expect(obj instanceof realZ.ZodObject).toBe(true);
  });

  it('LAZY_TARGET exposes the underlying LazyZodSchema', () => {
    const s = z.object({ a: z.string() });
    const target = (s as unknown as Record<symbol, unknown>)[LAZY_TARGET];
    expect(target).toBeInstanceOf(LazyZodSchema);
  });

  it('.constructor is the real ZodObject class (not a bound wrapper)', () => {
    const s = z.object({ a: z.string() });
    // `schema.constructor.name` MUST equal 'ZodObject' — codegen scripts
    // detect zod schema types via this property.
    expect((s as unknown as { constructor: { name: string } }).constructor.name).toBe('ZodObject');
  });

  it('class-like values (ZodError) return unbound', () => {
    const s = z.object({ a: z.string() });
    s.parse({ a: 'x' }); // materialize
    // Access a class-typed property on the schema — the Proxy must not bind
    // classes (binding mangles their `.name`).
    const ctor = (s as unknown as { constructor: { prototype: unknown; name: string } }).constructor;
    expect(typeof ctor).toBe('function');
    expect(typeof ctor.prototype).toBe('object');
    expect(ctor.name).toBe('ZodObject');
  });

  it('`has` trap reports true for chain methods without materializing', () => {
    let called = 0;
    const factory = () => {
      called++;
      return realZ.object({ a: realZ.string() });
    };
    const lazy: unknown = require('../lazy-schema').wrapLazy(new LazyZodSchema(factory));
    expect('optional' in (lazy as object)).toBe(true);
    expect('parse' in (lazy as object)).toBe(true);
    expect(called).toBe(0);
  });
});
