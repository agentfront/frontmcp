import { z as realZ } from 'zod';

import { z } from '../lazy-z';
import { forceMaterialize, isLazy } from '../utils';

describe('isLazy', () => {
  it('returns true for lazy z-proxy schemas', () => {
    expect(isLazy(z.object({ a: z.string() }))).toBe(true);
    expect(isLazy(z.union([z.string(), z.number()]))).toBe(true);
  });

  it('returns true for chained lazies', () => {
    expect(isLazy(z.object({ a: z.string() }).optional())).toBe(true);
  });

  it('returns false for real zod schemas', () => {
    expect(isLazy(realZ.object({ a: realZ.string() }))).toBe(false);
    expect(isLazy(realZ.string())).toBe(false);
  });

  it('returns false for primitives and non-objects', () => {
    expect(isLazy(null)).toBe(false);
    expect(isLazy(undefined)).toBe(false);
    expect(isLazy(42)).toBe(false);
    expect(isLazy('x')).toBe(false);
    expect(isLazy(true)).toBe(false);
  });

  it('returns false for plain objects', () => {
    expect(isLazy({})).toBe(false);
    expect(isLazy({ foo: 'bar' })).toBe(false);
  });
});

describe('forceMaterialize', () => {
  it('returns a real zod schema from a lazy one', () => {
    const lazyS = z.object({ a: z.string() });
    const real = forceMaterialize(lazyS);
    expect(isLazy(real)).toBe(false);
    expect(real).toBeInstanceOf(realZ.ZodObject);
    expect(real.parse({ a: 'x' })).toEqual({ a: 'x' });
  });

  it('returns non-lazy schemas unchanged', () => {
    const raw = realZ.object({ a: realZ.string() });
    expect(forceMaterialize(raw)).toBe(raw);
  });
});
