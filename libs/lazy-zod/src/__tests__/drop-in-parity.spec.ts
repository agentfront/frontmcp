import { z as realZ } from 'zod';

import { z as lazy } from '../lazy-z';

type Case = {
  name: string;
  build: (Z: typeof realZ) => ReturnType<typeof realZ.object> | ReturnType<typeof realZ.string>;
  valid: unknown[];
  invalid: unknown[];
};

/**
 * 30 schemas covering every factory + every chain method actually used in
 * the monorepo. Each runs through both real zod and lazy zod; results
 * must match structurally for valid input, and safeParse.success must
 * match on invalid input.
 */
const cases: Case[] = [
  {
    name: 'flat object',
    build: (Z) => Z.object({ a: Z.string(), b: Z.number().optional() }),
    valid: [{ a: 'x' }, { a: 'y', b: 42 }],
    invalid: [{ a: 1 }, {}, null],
  },
  {
    name: 'nested object',
    build: (Z) =>
      Z.object({
        user: Z.object({ id: Z.string(), age: Z.number().int().nonnegative() }),
        tags: Z.array(Z.string()).optional(),
      }),
    valid: [{ user: { id: 'u1', age: 30 } }, { user: { id: 'u2', age: 0 }, tags: ['a', 'b'] }],
    invalid: [{ user: { id: 'u', age: -1 } }, { user: { id: 3, age: 10 } }],
  },
  {
    name: 'discriminated union',
    build: (Z) =>
      Z.discriminatedUnion('kind', [
        Z.object({ kind: Z.literal('a'), a: Z.string() }),
        Z.object({ kind: Z.literal('b'), b: Z.number() }),
      ]),
    valid: [
      { kind: 'a', a: 'x' },
      { kind: 'b', b: 1 },
    ],
    invalid: [{ kind: 'c' }, { kind: 'a', b: 1 }],
  },
  {
    name: 'union',
    build: (Z) => Z.union([Z.string(), Z.number()]),
    valid: ['x', 42],
    invalid: [true, {}, null],
  },
  {
    name: 'record',
    build: (Z) => Z.record(Z.string(), Z.number()),
    valid: [{}, { a: 1, b: 2 }],
    invalid: [{ a: 'x' }, null],
  },
  {
    name: 'tuple',
    build: (Z) => Z.tuple([Z.string(), Z.number(), Z.boolean()]),
    valid: [['x', 1, true]],
    invalid: [['x', 1], ['x', 1, 'nope'], null],
  },
  {
    name: 'intersection',
    build: (Z) => Z.intersection(Z.object({ a: Z.string() }), Z.object({ b: Z.number() })),
    valid: [{ a: 'x', b: 1 }],
    invalid: [{ a: 'x' }, { b: 1 }],
  },
  {
    name: 'chain: optional',
    build: (Z) => Z.object({ x: Z.string().optional() }),
    valid: [{}, { x: 'v' }],
    invalid: [{ x: 1 }],
  },
  {
    name: 'chain: nullable',
    build: (Z) => Z.object({ x: Z.string().nullable() }),
    valid: [{ x: null }, { x: 'v' }],
    invalid: [{ x: 1 }, { x: undefined }],
  },
  {
    name: 'chain: default',
    build: (Z) => Z.object({ x: Z.string().default('hi') }),
    valid: [{}, { x: 'y' }],
    invalid: [{ x: 1 }],
  },
  {
    name: 'chain: describe',
    build: (Z) => Z.object({ x: Z.string().describe('a string') }),
    valid: [{ x: 'v' }],
    invalid: [{ x: 1 }],
  },
  {
    name: 'chain: refine',
    build: (Z) => Z.object({ n: Z.number().refine((v) => v > 0, 'must be positive') }),
    valid: [{ n: 1 }],
    invalid: [{ n: 0 }, { n: -1 }],
  },
  {
    name: 'chain: extend',
    build: (Z) => Z.object({ a: Z.string() }).extend({ b: Z.number() }),
    valid: [{ a: 'x', b: 1 }],
    invalid: [{ a: 'x' }, { b: 1 }],
  },
  {
    name: 'chain: merge',
    build: (Z) => Z.object({ a: Z.string() }).merge(Z.object({ b: Z.number() })),
    valid: [{ a: 'x', b: 1 }],
    invalid: [{ a: 'x' }, {}],
  },
  {
    name: 'chain: pick',
    build: (Z) => Z.object({ a: Z.string(), b: Z.number() }).pick({ a: true }),
    valid: [{ a: 'x' }],
    invalid: [{ a: 1 }, {}],
  },
  {
    name: 'chain: omit',
    build: (Z) => Z.object({ a: Z.string(), b: Z.number() }).omit({ b: true }),
    valid: [{ a: 'x' }],
    invalid: [{ a: 1 }],
  },
  {
    name: 'chain: partial',
    build: (Z) => Z.object({ a: Z.string(), b: Z.number() }).partial(),
    valid: [{}, { a: 'x' }, { a: 'x', b: 1 }],
    invalid: [{ a: 1 }],
  },
  {
    name: 'chain: passthrough',
    build: (Z) => Z.object({ a: Z.string() }).passthrough(),
    valid: [{ a: 'x', extra: 'keep' }],
    invalid: [{ a: 1 }],
  },
  {
    name: 'chain: strict',
    build: (Z) => Z.object({ a: Z.string() }).strict(),
    valid: [{ a: 'x' }],
    invalid: [{ a: 'x', extra: 'nope' }, { a: 1 }],
  },
  {
    name: 'array min/max',
    build: (Z) => Z.object({ xs: Z.array(Z.string()).min(1).max(3) }),
    valid: [{ xs: ['a'] }, { xs: ['a', 'b', 'c'] }],
    invalid: [{ xs: [] }, { xs: ['a', 'b', 'c', 'd'] }],
  },
  {
    name: 'string chain: min, max, email',
    build: (Z) => Z.object({ email: Z.string().min(3).max(50).email() }),
    valid: [{ email: 'a@b.co' }],
    invalid: [{ email: 'nope' }, { email: '' }],
  },
  {
    name: 'number chain: int, positive',
    build: (Z) => Z.object({ n: Z.number().int().positive() }),
    valid: [{ n: 1 }, { n: 10 }],
    invalid: [{ n: 0 }, { n: 1.5 }, { n: -1 }],
  },
  {
    name: 'chain: transform',
    build: (Z) => Z.object({ x: Z.string().transform((s) => s.toUpperCase()) }),
    valid: [{ x: 'hi' }],
    invalid: [{ x: 1 }],
  },
  {
    name: 'enum',
    build: (Z) => Z.object({ role: Z.enum(['admin', 'user', 'guest']) }),
    valid: [{ role: 'admin' }, { role: 'guest' }],
    invalid: [{ role: 'nope' }, { role: 1 }],
  },
  {
    name: 'literal',
    build: (Z) => Z.object({ v: Z.literal('fixed') }),
    valid: [{ v: 'fixed' }],
    invalid: [{ v: 'other' }],
  },
  {
    name: 'date',
    build: (Z) => Z.object({ d: Z.date() }),
    valid: [{ d: new Date() }],
    invalid: [{ d: 'not-a-date' }, { d: 123 }],
  },
  {
    name: 'boolean',
    build: (Z) => Z.object({ b: Z.boolean() }),
    valid: [{ b: true }, { b: false }],
    invalid: [{ b: 'true' }, { b: 1 }],
  },
  {
    name: 'any',
    build: (Z) => Z.object({ payload: Z.any() }),
    valid: [{ payload: 1 }, { payload: 'x' }, { payload: null }],
    invalid: [],
  },
  {
    name: 'chain: or',
    build: (Z) => Z.object({ v: Z.string().or(Z.number()) }),
    valid: [{ v: 'x' }, { v: 1 }],
    invalid: [{ v: true }],
  },
  {
    name: 'chain: array()',
    build: (Z) => Z.object({ xs: Z.string().array() }),
    valid: [{ xs: [] }, { xs: ['a', 'b'] }],
    invalid: [{ xs: [1] }, { xs: 'nope' }],
  },
];

describe('drop-in parity vs real zod', () => {
  for (const c of cases) {
    describe(c.name, () => {
      const realSchema = c.build(realZ);
      const lazySchema = c.build(lazy);

      it('parses valid input to identical output', () => {
        for (const input of c.valid) {
          expect(lazySchema.parse(input)).toEqual(realSchema.parse(input));
        }
      });

      it('rejects invalid input consistently', () => {
        for (const input of c.invalid) {
          const realResult = realSchema.safeParse(input);
          const lazyResult = lazySchema.safeParse(input);
          expect(lazyResult.success).toBe(realResult.success);
          expect(lazyResult.success).toBe(false);
        }
      });
    });
  }
});
