import { z as realZ } from 'zod';

import { eagerZ } from '../eager-z';
import { isLazy } from '../utils';

describe('eagerZ', () => {
  it('is the same reference as real zod `z`', () => {
    expect(eagerZ).toBe(realZ);
  });

  it('produces non-lazy schemas', () => {
    const s = eagerZ.object({ a: eagerZ.string() });
    expect(isLazy(s)).toBe(false);
  });

  it('parses correctly', () => {
    const s = eagerZ.object({ n: eagerZ.number() });
    expect(s.parse({ n: 1 })).toEqual({ n: 1 });
    expect(s.safeParse({ n: 'x' }).success).toBe(false);
  });

  it('produces instances of real zod classes', () => {
    const s = eagerZ.object({ a: eagerZ.string() });
    expect(s).toBeInstanceOf(realZ.ZodObject);
  });
});
