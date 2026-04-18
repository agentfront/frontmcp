/**
 * Compile-time assertions for type inference. These don't exercise runtime
 * behavior — if the file compiles, the types are correct.
 *
 * Uses `expectType` helper: compiles if and only if A is assignable to B
 * and B is assignable to A.
 */
import { lazyZ } from '../lazy-schema';
import { z } from '../lazy-z';

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<A, B>(_: Eq<A, B> extends true ? true : never): void {
  void _;
}

describe('type inference (compile-time)', () => {
  it('z.infer on z.object yields the expected shape', () => {
    const s = z.object({ a: z.string(), b: z.number().optional() });
    type T = z.infer<typeof s>;
    expectType<T, { a: string; b?: number | undefined }>(true);
  });

  it('z.infer on z.union', () => {
    const s = z.union([z.string(), z.number()]);
    type T = z.infer<typeof s>;
    expectType<T, string | number>(true);
  });

  it('z.infer on z.discriminatedUnion', () => {
    const s = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ]);
    type T = z.infer<typeof s>;
    expectType<T, { kind: 'a'; a: string } | { kind: 'b'; b: number }>(true);
  });

  it('z.infer on chained .optional()', () => {
    const s = z.object({ a: z.string() }).optional();
    type T = z.infer<typeof s>;
    expectType<T, { a: string } | undefined>(true);
  });

  it('lazyZ preserves the inner type', () => {
    const s = lazyZ(() => z.object({ a: z.string() }));
    type T = z.infer<typeof s>;
    expectType<T, { a: string }>(true);
  });

  it('z.infer on z.array', () => {
    const s = z.array(z.string());
    type T = z.infer<typeof s>;
    expectType<T, string[]>(true);
  });

  it('z.infer on z.record', () => {
    const s = z.record(z.string(), z.number());
    type T = z.infer<typeof s>;
    expectType<T, Record<string, number>>(true);
  });

  it('z.infer on z.tuple', () => {
    const s = z.tuple([z.string(), z.number(), z.boolean()]);
    type T = z.infer<typeof s>;
    expectType<T, [string, number, boolean]>(true);
  });

  it('z.infer on nested .extend', () => {
    const base = z.object({ a: z.string() });
    const extended = base.extend({ b: z.number() });
    type T = z.infer<typeof extended>;
    expectType<T, { a: string; b: number }>(true);
  });

  it('z.ZodRawShape is usable', () => {
    const shape: z.ZodRawShape = { a: z.string(), b: z.number() };
    const s = z.object(shape);
    expect(s.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
  });
});
