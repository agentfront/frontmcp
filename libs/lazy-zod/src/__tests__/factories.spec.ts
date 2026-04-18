import { HEAVY_FACTORIES } from '../factories';
import { z } from '../lazy-z';
import { isLazy } from '../utils';

describe('factories', () => {
  describe('HEAVY (lazy)', () => {
    it('z.object returns a lazy schema', () => {
      const s = z.object({ a: z.string() });
      expect(isLazy(s)).toBe(true);
      expect(s.parse({ a: 'x' })).toEqual({ a: 'x' });
    });

    it('z.union returns a lazy schema', () => {
      const s = z.union([z.string(), z.number()]);
      expect(isLazy(s)).toBe(true);
      expect(s.parse('x')).toBe('x');
      expect(s.parse(42)).toBe(42);
    });

    it('z.discriminatedUnion returns a lazy schema', () => {
      const s = z.discriminatedUnion('k', [
        z.object({ k: z.literal('a'), a: z.string() }),
        z.object({ k: z.literal('b'), b: z.number() }),
      ]);
      expect(isLazy(s)).toBe(true);
      expect(s.parse({ k: 'a', a: 'x' })).toEqual({ k: 'a', a: 'x' });
    });

    it('z.intersection returns a lazy schema', () => {
      const s = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
      expect(isLazy(s)).toBe(true);
      expect(s.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
    });

    it('z.record returns a lazy schema', () => {
      const s = z.record(z.string(), z.number());
      expect(isLazy(s)).toBe(true);
      expect(s.parse({ a: 1 })).toEqual({ a: 1 });
    });

    it('z.tuple returns a lazy schema', () => {
      const s = z.tuple([z.string(), z.number()]);
      expect(isLazy(s)).toBe(true);
      expect(s.parse(['x', 1])).toEqual(['x', 1]);
    });

    it('every HEAVY_FACTORIES entry is present on lazy z', () => {
      for (const name of HEAVY_FACTORIES) {
        expect(typeof (z as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });
  });

  describe('LIGHT (pass-through)', () => {
    const cases: Array<{ name: string; schema: unknown; sample: unknown }> = [
      { name: 'string', schema: z.string(), sample: 'x' },
      { name: 'number', schema: z.number(), sample: 42 },
      { name: 'boolean', schema: z.boolean(), sample: true },
      { name: 'date', schema: z.date(), sample: new Date() },
      { name: 'bigint', schema: z.bigint(), sample: 1n },
      { name: 'enum', schema: z.enum(['a', 'b']), sample: 'a' },
      { name: 'literal', schema: z.literal('x'), sample: 'x' },
      { name: 'array', schema: z.array(z.string()), sample: ['a'] },
      { name: 'any', schema: z.any(), sample: 42 },
      { name: 'unknown', schema: z.unknown(), sample: 42 },
      { name: 'null', schema: z.null(), sample: null },
      { name: 'undefined', schema: z.undefined(), sample: undefined },
      { name: 'void', schema: z.void(), sample: undefined },
      { name: 'nan', schema: z.nan(), sample: NaN },
    ];
    for (const c of cases) {
      it(`z.${c.name} returns a non-lazy schema that parses`, () => {
        expect(isLazy(c.schema)).toBe(false);
        expect((c.schema as { parse: (x: unknown) => unknown }).parse(c.sample)).toEqual(c.sample);
      });
    }

    it('z.lazy (for recursion) is pass-through', () => {
      type Tree = { v: number; children?: Tree[] };
      const tree: import('zod').ZodType<Tree> = z.lazy(() =>
        z.object({ v: z.number(), children: z.array(tree).optional() }),
      );
      expect(isLazy(tree)).toBe(false);
      expect(tree.parse({ v: 1, children: [{ v: 2 }] })).toEqual({ v: 1, children: [{ v: 2 }] });
    });

    it('z.custom is pass-through', () => {
      const s = z.custom<string>((v) => typeof v === 'string');
      expect(isLazy(s)).toBe(false);
      expect(s.parse('hi')).toBe('hi');
      expect(s.safeParse(1).success).toBe(false);
    });
  });
});
