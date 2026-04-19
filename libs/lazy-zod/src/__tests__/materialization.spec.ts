import { z as realZ } from 'zod';

import { LAZY_TARGET, lazyZ, type LazyZodSchema } from '../lazy-schema';
import { z } from '../lazy-z';
import { forceMaterialize, isLazy } from '../utils';

describe('materialization', () => {
  it('factory is called 0 times before first parse', () => {
    const factory = jest.fn(() => realZ.object({ a: realZ.string() }));
    lazyZ(factory);
    expect(factory).toHaveBeenCalledTimes(0);
  });

  it('factory is called exactly once across multiple parses', () => {
    const factory = jest.fn(() => realZ.object({ a: realZ.string() }));
    const s = lazyZ(factory);
    for (let i = 0; i < 5; i++) s.parse({ a: 'x' });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('self-patch: .parse becomes an own-prop on LazyZodSchema after first call', () => {
    const s = z.object({ a: z.string() });
    const target = (s as unknown as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
    expect(Object.prototype.hasOwnProperty.call(target, 'parse')).toBe(false);
    s.parse({ a: 'x' });
    expect(Object.prototype.hasOwnProperty.call(target, 'parse')).toBe(true);
  });

  it('self-patches each hot method independently', () => {
    const s = z.object({ a: z.string() });
    const target = (s as unknown as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
    s.parse({ a: 'x' });
    expect(Object.prototype.hasOwnProperty.call(target, 'parse')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(target, 'safeParse')).toBe(false);
    s.safeParse({ a: 'x' });
    expect(Object.prototype.hasOwnProperty.call(target, 'safeParse')).toBe(true);
  });

  it('chained lazies only materialize up to the invoked chain level', () => {
    const baseFactory = jest.fn(() => realZ.object({ a: realZ.string() }));
    const base = lazyZ(baseFactory);
    const optional = (base as unknown as { optional: () => unknown }).optional() as {
      parse: (d: unknown) => unknown;
    };
    expect(baseFactory).toHaveBeenCalledTimes(0);
    optional.parse(undefined);
    expect(baseFactory).toHaveBeenCalledTimes(1);
    optional.parse(undefined);
    expect(baseFactory).toHaveBeenCalledTimes(1);
  });

  it('isMaterialized reflects state', () => {
    const s = z.object({ a: z.string() });
    const target = (s as unknown as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
    expect(target.isMaterialized).toBe(false);
    s.parse({ a: 'x' });
    expect(target.isMaterialized).toBe(true);
  });

  it('forceMaterialize returns the real zod schema', () => {
    const s = z.object({ a: z.string() });
    const real = forceMaterialize(s);
    expect(isLazy(real)).toBe(false);
    expect(real).toBeInstanceOf(realZ.ZodObject);
  });

  it('forceMaterialize is a no-op for non-lazy schemas', () => {
    const raw = realZ.object({ a: realZ.string() });
    expect(forceMaterialize(raw)).toBe(raw);
  });
});
