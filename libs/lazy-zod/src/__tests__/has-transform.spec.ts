import { z as realZ } from 'zod';

import { z } from '../lazy-z';
import { hasTransform } from '../utils';

describe('hasTransform', () => {
  it.each([
    ['a .transform()', z.object({ a: z.string() }).transform((value) => ({ renamed: value.a }))],
    ['a z.preprocess()', z.preprocess((value) => value, z.object({ a: z.string() }))],
    ['a .pipe()', z.string().pipe(z.coerce.number())],
    ['a codec', z.codec(z.string(), z.number(), { decode: Number, encode: String })],
    ['a transform on an object field', z.object({ at: z.string().transform((value) => new Date(value)) })],
    ['a transform in an array element', z.array(z.object({ a: z.string() }).transform((value) => value.a))],
    ['a transform in a union option', z.union([z.object({ a: z.string() }), z.string().transform(Number)])],
    ['a transform under optional and nullable', z.object({ a: z.string().transform(Number).optional().nullable() })],
    ['a transform in a record value', z.record(z.string(), z.string().transform(Number))],
    ['a transform behind z.lazy()', z.object({ next: z.lazy(() => z.string().transform(Number)) })],
    ['a real zod transform', realZ.object({ a: realZ.string() }).transform((value) => value.a)],
  ])('is true for %s', (_label, schema) => {
    expect(hasTransform(schema)).toBe(true);
  });

  it.each([
    ['an object', z.object({ a: z.string(), b: z.array(z.number()) })],
    [
      'a discriminated union',
      z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('b') })]),
    ],
    ['refinements and defaults', z.object({ a: z.string().refine(Boolean).default('x') })],
    ['an intersection and a tuple', z.intersection(z.object({ a: z.string() }), z.tuple([z.number()]))],
    ['a real zod object', realZ.object({ a: realZ.string() })],
    ['something that is not a schema', { a: 'b' }],
  ])('is false for %s', (_label, schema) => {
    expect(hasTransform(schema)).toBe(false);
  });

  it('terminates on a recursive schema', () => {
    type Node = { children: Node[] };
    const node: z.ZodType<Node> = z.object({ children: z.array(z.lazy(() => node)) });

    expect(hasTransform(node)).toBe(false);
  });
});
