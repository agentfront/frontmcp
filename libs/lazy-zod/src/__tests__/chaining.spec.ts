import { z } from '../lazy-z';
import { isLazy } from '../utils';

/**
 * Every chain method in use across the monorepo, applied against a lazy
 * base. Each chained result is still lazy and still parses correctly.
 */
describe('chain methods on lazy schemas', () => {
  describe('generic ZodType chains', () => {
    const base = () => z.object({ x: z.string() });

    it('.optional()', () => {
      const s = base().optional();
      expect(isLazy(s)).toBe(true);
      expect(s.parse(undefined)).toBeUndefined();
      expect(s.parse({ x: 'v' })).toEqual({ x: 'v' });
    });
    it('.nullable()', () => {
      const s = base().nullable();
      expect(s.parse(null)).toBeNull();
      expect(s.parse({ x: 'v' })).toEqual({ x: 'v' });
    });
    it('.nullish()', () => {
      const s = base().nullish();
      expect(s.parse(undefined)).toBeUndefined();
      expect(s.parse(null)).toBeNull();
    });
    it('.default()', () => {
      const s = base().default({ x: 'dflt' });
      expect(s.parse(undefined)).toEqual({ x: 'dflt' });
    });
    it('.describe()', () => {
      const s = base().describe('a thing');
      expect(s.parse({ x: 'v' })).toEqual({ x: 'v' });
    });
    it('.refine()', () => {
      const s = base().refine((v) => v.x.length > 0, 'non-empty');
      expect(s.safeParse({ x: '' }).success).toBe(false);
      expect(s.safeParse({ x: 'v' }).success).toBe(true);
    });
    it('.transform()', () => {
      const s = base().transform((v) => v.x.toUpperCase());
      expect(s.parse({ x: 'hi' })).toBe('HI');
    });
    it('.or()', () => {
      const s = base().or(z.object({ y: z.number() }));
      expect(s.parse({ x: 'v' })).toEqual({ x: 'v' });
      expect(s.parse({ y: 1 })).toEqual({ y: 1 });
    });
    it('.array()', () => {
      const s = base().array();
      expect(s.parse([{ x: 'v' }, { x: 'w' }])).toEqual([{ x: 'v' }, { x: 'w' }]);
    });
    it('.catch()', () => {
      const s = z.number().catch(0);
      expect(s.parse('not-a-number')).toBe(0);
    });
    it('.readonly()', () => {
      const s = z.array(z.string()).readonly();
      expect(s.parse(['a'])).toEqual(['a']);
    });
  });

  describe('ZodString chains', () => {
    it('.min, .max, .length', () => {
      expect(z.string().min(2).safeParse('a').success).toBe(false);
      expect(z.string().max(2).safeParse('abc').success).toBe(false);
      expect(z.string().length(3).safeParse('abc').success).toBe(true);
    });
    it('.email, .url, .uuid, .regex', () => {
      expect(z.string().email().safeParse('alice@example.com').success).toBe(true);
      expect(z.string().email().safeParse('not-an-email').success).toBe(false);
      expect(z.string().url().safeParse('https://example.com').success).toBe(true);
      expect(z.string().uuid().safeParse('123e4567-e89b-12d3-a456-426614174000').success).toBe(true);
      expect(
        z
          .string()
          .regex(/^[a-z]+$/)
          .safeParse('abc').success,
      ).toBe(true);
    });
    it('.startsWith, .endsWith, .includes', () => {
      expect(z.string().startsWith('foo').safeParse('foobar').success).toBe(true);
      expect(z.string().endsWith('bar').safeParse('foobar').success).toBe(true);
      expect(z.string().includes('oob').safeParse('foobar').success).toBe(true);
    });
    it('.trim, .toLowerCase, .toUpperCase', () => {
      expect(z.string().trim().parse('  hi  ')).toBe('hi');
      expect(z.string().toLowerCase().parse('HI')).toBe('hi');
      expect(z.string().toUpperCase().parse('hi')).toBe('HI');
    });
  });

  describe('ZodNumber chains', () => {
    it('.int, .positive, .negative, .nonnegative', () => {
      expect(z.number().int().safeParse(1.5).success).toBe(false);
      expect(z.number().positive().safeParse(0).success).toBe(false);
      expect(z.number().negative().safeParse(0).success).toBe(false);
      expect(z.number().nonnegative().safeParse(0).success).toBe(true);
    });
    it('.gt, .gte, .lt, .lte', () => {
      expect(z.number().gt(5).safeParse(5).success).toBe(false);
      expect(z.number().gte(5).safeParse(5).success).toBe(true);
      expect(z.number().lt(5).safeParse(5).success).toBe(false);
      expect(z.number().lte(5).safeParse(5).success).toBe(true);
    });
    it('.multipleOf', () => {
      expect(z.number().multipleOf(3).safeParse(9).success).toBe(true);
      expect(z.number().multipleOf(3).safeParse(10).success).toBe(false);
    });
    it('.finite', () => {
      expect(z.number().finite().safeParse(Infinity).success).toBe(false);
    });
  });

  describe('ZodObject chains', () => {
    const base = () => z.object({ a: z.string(), b: z.number() });
    it('.extend', () => {
      expect(base().extend({ c: z.boolean() }).parse({ a: 'x', b: 1, c: true })).toEqual({
        a: 'x',
        b: 1,
        c: true,
      });
    });
    it('.merge', () => {
      expect(
        base()
          .merge(z.object({ c: z.boolean() }))
          .parse({ a: 'x', b: 1, c: true }),
      ).toEqual({
        a: 'x',
        b: 1,
        c: true,
      });
    });
    it('.pick', () => {
      expect(base().pick({ a: true }).parse({ a: 'x' })).toEqual({ a: 'x' });
    });
    it('.omit', () => {
      expect(base().omit({ b: true }).parse({ a: 'x' })).toEqual({ a: 'x' });
    });
    it('.partial', () => {
      expect(base().partial().parse({})).toEqual({});
    });
    it('.passthrough, .strict, .strip', () => {
      expect(base().passthrough().parse({ a: 'x', b: 1, extra: 1 })).toEqual({ a: 'x', b: 1, extra: 1 });
      expect(base().strict().safeParse({ a: 'x', b: 1, extra: 1 }).success).toBe(false);
      expect(base().strip().parse({ a: 'x', b: 1, extra: 1 })).toEqual({ a: 'x', b: 1 });
    });
    it('.keyof', () => {
      const keys = base().keyof();
      expect(keys.parse('a')).toBe('a');
      expect(keys.safeParse('nope').success).toBe(false);
    });
  });

  describe('ZodArray chains', () => {
    it('.nonempty, .min, .max, .length', () => {
      expect(z.array(z.string()).nonempty().safeParse([]).success).toBe(false);
      expect(z.array(z.string()).min(1).safeParse([]).success).toBe(false);
      expect(z.array(z.string()).max(1).safeParse(['a', 'b']).success).toBe(false);
      expect(z.array(z.string()).length(2).safeParse(['a', 'b']).success).toBe(true);
    });
  });

  describe('composition', () => {
    it('deep chain: object → extend → partial → passthrough', () => {
      const s = z.object({ a: z.string() }).extend({ b: z.number() }).partial().passthrough();
      expect(s.parse({ extra: 'ok' })).toEqual({ extra: 'ok' });
      expect(s.parse({ a: 'x', b: 1, extra: 'ok' })).toEqual({ a: 'x', b: 1, extra: 'ok' });
    });
    it('lazy inside lazy (object of object)', () => {
      const s = z.object({ inner: z.object({ v: z.string() }) });
      expect(s.parse({ inner: { v: 'x' } })).toEqual({ inner: { v: 'x' } });
    });
  });
});
