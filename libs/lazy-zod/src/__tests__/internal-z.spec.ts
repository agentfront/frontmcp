import { z as realZ } from 'zod';

import { HEAVY_FACTORIES, LEAF_FACTORIES } from '../factories';
import { internalZ, toJSONSchema, z } from '../index';
import { LAZY_TARGET, type LazyZodSchema } from '../lazy-schema';
import { isLazy } from '../utils';

type Namespace = typeof realZ;

function targetOf(schema: unknown): LazyZodSchema {
  return (schema as Record<symbol, LazyZodSchema>)[LAZY_TARGET];
}

function isBuilt(schema: unknown): boolean {
  return targetOf(schema).isMaterialized;
}

enum Color {
  Red = 'red',
  Blue = 'blue',
}

class Widget {
  constructor(readonly id: string) {}
}

type FactoryCase = {
  factory: string;
  build: (Z: Namespace) => realZ.ZodType;
  valid: unknown[];
  invalid: unknown[];
};

const factoryCases: FactoryCase[] = [
  { factory: 'string', build: (Z) => Z.string().min(2), valid: ['ab'], invalid: ['a', 1, null] },
  { factory: 'number', build: (Z) => Z.number().positive(), valid: [1, 2.5], invalid: [0, '1', NaN] },
  { factory: 'int', build: (Z) => Z.int(), valid: [3], invalid: [1.5, '3'] },
  { factory: 'boolean', build: (Z) => Z.boolean(), valid: [true, false], invalid: ['true', 0] },
  { factory: 'bigint', build: (Z) => Z.bigint(), valid: [1n], invalid: [1] },
  { factory: 'symbol', build: (Z) => Z.symbol(), valid: [Symbol.for('a')], invalid: ['a'] },
  { factory: 'date', build: (Z) => Z.date(), valid: [new Date(0)], invalid: ['2020-01-01', new Date('x')] },
  { factory: 'undefined', build: (Z) => Z.undefined(), valid: [undefined], invalid: [null] },
  { factory: 'null', build: (Z) => Z.null(), valid: [null], invalid: [undefined] },
  { factory: 'void', build: (Z) => Z.void(), valid: [undefined], invalid: [0] },
  { factory: 'any', build: (Z) => Z.any(), valid: [1, 'x', null], invalid: [] },
  { factory: 'unknown', build: (Z) => Z.unknown(), valid: [1, undefined], invalid: [] },
  { factory: 'never', build: (Z) => Z.never(), valid: [], invalid: [1, undefined] },
  { factory: 'nan', build: (Z) => Z.nan(), valid: [NaN], invalid: [1] },
  { factory: 'literal', build: (Z) => Z.literal('on'), valid: ['on'], invalid: ['off'] },
  { factory: 'enum', build: (Z) => Z.enum(['a', 'b']), valid: ['a'], invalid: ['c', 1] },
  { factory: 'nativeEnum', build: (Z) => Z.nativeEnum(Color), valid: ['red'], invalid: ['green'] },
  { factory: 'url', build: (Z) => Z.url(), valid: ['https://example.com'], invalid: ['not a url'] },
  { factory: 'email', build: (Z) => Z.email(), valid: ['a@b.co'], invalid: ['a@'] },
  { factory: 'uuid', build: (Z) => Z.uuid(), valid: ['123e4567-e89b-42d3-a456-426614174000'], invalid: ['123'] },
  { factory: 'array', build: (Z) => Z.array(Z.string()).max(2), valid: [[], ['a']], invalid: [['a', 'b', 'c'], [1]] },
  { factory: 'set', build: (Z) => Z.set(Z.number()), valid: [new Set([1])], invalid: [new Set(['a']), [1]] },
  {
    factory: 'map',
    build: (Z) => Z.map(Z.string(), Z.number()),
    valid: [new Map([['a', 1]])],
    invalid: [new Map([['a', 'b']])],
  },
  {
    factory: 'partialRecord',
    build: (Z) => Z.partialRecord(Z.enum(['a', 'b']), Z.number()),
    valid: [{}, { a: 1 }],
    invalid: [{ c: 1 }, { a: 'x' }],
  },
  { factory: 'optional', build: (Z) => Z.optional(Z.string()), valid: [undefined, 'x'], invalid: [1] },
  { factory: 'nullable', build: (Z) => Z.nullable(Z.string()), valid: [null, 'x'], invalid: [undefined] },
  { factory: 'lazy', build: (Z) => Z.lazy(() => Z.string()), valid: ['x'], invalid: [1] },
  { factory: 'function', build: (Z) => Z.function(), valid: [() => 1], invalid: ['fn'] },
  { factory: 'custom', build: (Z) => Z.custom<string>((v) => typeof v === 'string'), valid: ['x'], invalid: [1] },
  { factory: 'instanceof', build: (Z) => Z.instanceof(Widget), valid: [new Widget('w')], invalid: [{ id: 'w' }] },
  {
    factory: 'preprocess',
    build: (Z) => Z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), Z.number()),
    valid: ['2', 3],
    invalid: ['x', null],
  },
  {
    factory: 'object',
    build: (Z) => Z.object({ name: Z.string(), age: Z.number().int().optional() }),
    valid: [{ name: 'a' }, { name: 'a', age: 2, extra: true }],
    invalid: [{}, { name: 1 }, { name: 'a', age: 1.5 }, null],
  },
  {
    factory: 'strictObject',
    build: (Z) => Z.strictObject({ name: Z.string() }),
    valid: [{ name: 'a' }],
    invalid: [{ name: 'a', extra: true }],
  },
  {
    factory: 'looseObject',
    build: (Z) => Z.looseObject({ name: Z.string() }),
    valid: [{ name: 'a', extra: true }],
    invalid: [{ extra: true }],
  },
  {
    factory: 'union',
    build: (Z) => Z.union([Z.string(), Z.object({ n: Z.number() })]),
    valid: ['x', { n: 1 }],
    invalid: [{ n: 'x' }, 1],
  },
  {
    factory: 'discriminatedUnion',
    build: (Z) =>
      Z.discriminatedUnion('kind', [
        Z.object({ kind: Z.literal('a'), a: Z.string() }),
        Z.object({ kind: Z.literal('b'), b: Z.number() }),
      ]),
    valid: [
      { kind: 'a', a: 'x' },
      { kind: 'b', b: 1 },
    ],
    invalid: [{ kind: 'c' }, { kind: 'a', a: 1 }, {}],
  },
  {
    factory: 'intersection',
    build: (Z) => Z.intersection(Z.object({ a: Z.string() }), Z.object({ b: Z.number() })),
    valid: [{ a: 'x', b: 1 }],
    invalid: [{ a: 'x' }, { b: 1 }],
  },
  {
    factory: 'record',
    build: (Z) => Z.record(Z.string(), Z.array(Z.number())),
    valid: [{}, { a: [1] }],
    invalid: [{ a: ['x'] }, []],
  },
  {
    factory: 'tuple',
    build: (Z) => Z.tuple([Z.string(), Z.number()], Z.boolean()),
    valid: [
      ['a', 1],
      ['a', 1, true],
    ],
    invalid: [['a'], ['a', 1, 'x']],
  },
];

type ChainCase = { name: string; build: (Z: Namespace) => realZ.ZodType; valid: unknown[]; invalid: unknown[] };

const chainCases: ChainCase[] = [
  {
    name: 'string checks and formats',
    build: (Z) =>
      Z.string()
        .trim()
        .min(1)
        .max(5)
        .regex(/^[a-z]+$/),
    valid: [' abc '],
    invalid: ['', 'abcdef', 'ABC'],
  },
  {
    name: 'number checks',
    build: (Z) => Z.number().int().nonnegative().max(10),
    valid: [0, 10],
    invalid: [-1, 11, 1.2],
  },
  {
    name: 'default and describe',
    build: (Z) => Z.string().default('d').describe('text'),
    valid: [undefined, 'x'],
    invalid: [1],
  },
  { name: 'nullish', build: (Z) => Z.number().nullish(), valid: [null, undefined, 1], invalid: ['1'] },
  { name: 'refine', build: (Z) => Z.number().refine((n) => n % 2 === 0, 'must be even'), valid: [2], invalid: [3] },
  {
    name: 'superRefine',
    build: (Z) =>
      Z.string().superRefine((value, ctx) => {
        if (value === 'bad') ctx.addIssue({ code: 'custom', message: 'no bad' });
      }),
    valid: ['ok'],
    invalid: ['bad'],
  },
  { name: 'transform', build: (Z) => Z.string().transform((s) => s.length), valid: ['abc'], invalid: [1] },
  { name: 'pipe', build: (Z) => Z.string().transform(Number).pipe(Z.number().int()), valid: ['3'], invalid: ['1.5'] },
  { name: 'or / and', build: (Z) => Z.string().or(Z.number()).and(Z.any()), valid: ['x', 1], invalid: [true] },
  { name: 'array() and nonempty', build: (Z) => Z.string().array().nonempty(), valid: [['a']], invalid: [[]] },
  { name: 'catch', build: (Z) => Z.number().catch(0), valid: [1, 'x'], invalid: [] },
  {
    name: 'object helpers',
    build: (Z) =>
      Z.object({ a: Z.string(), b: Z.number(), c: Z.boolean() })
        .extend({ d: Z.string().optional() })
        .pick({ a: true, b: true, d: true })
        .omit({ b: true })
        .partial({ a: true })
        .strict(),
    valid: [{}, { a: 'x', d: 'y' }],
    invalid: [{ a: 1 }, { b: 1 }],
  },
  {
    name: 'catchall',
    build: (Z) => Z.object({ a: Z.string() }).catchall(Z.number()),
    valid: [{ a: 'x', n: 1 }],
    invalid: [{ a: 'x', n: 'y' }],
  },
  {
    name: 'enum extract / exclude',
    build: (Z) => Z.enum(['a', 'b', 'c']).exclude(['c']),
    valid: ['a'],
    invalid: ['c'],
  },
  {
    name: 'nested optional sections',
    build: (Z) =>
      Z.object({
        info: Z.object({ name: Z.string().min(1), version: Z.string() }),
        auth: Z.object({ mode: Z.enum(['public', 'remote']), issuer: Z.url().optional() }).optional(),
        tags: Z.array(Z.string()).optional().default([]),
      }),
    valid: [{ info: { name: 'a', version: '1' } }, { info: { name: 'a', version: '1' }, auth: { mode: 'public' } }],
    invalid: [{ info: { name: '', version: '1' } }, { info: { name: 'a', version: '1' }, auth: { mode: 'x' } }],
  },
];

function expectSameResult(internal: realZ.ZodType, eager: realZ.ZodType, input: unknown): void {
  const expected = eager.safeParse(input);
  const actual = internal.safeParse(input);
  expect(actual.success).toBe(expected.success);
  if (expected.success && typeof expected.data === 'function') {
    expect(typeof actual.data).toBe('function');
  } else if (expected.success) {
    expect(actual.data).toEqual(expected.data);
  } else {
    expect(actual.error?.issues).toEqual(expected.error.issues);
    expect(actual.error?.message).toBe(expected.error.message);
  }
}

describe('public z', () => {
  it('passes every leaf factory through as Zod’s own function', () => {
    for (const name of LEAF_FACTORIES) {
      expect((z as unknown as Record<string, unknown>)[name]).toBe((realZ as unknown as Record<string, unknown>)[name]);
    }
  });

  it('returns Zod’s own schemas from leaf factories', () => {
    const schema = z.string();
    expect(isLazy(schema)).toBe(false);
    expect(schema).toBeInstanceOf(realZ.ZodString);
    expect(isLazy(z.array(z.string()))).toBe(false);
  });

  it('defers only the compound factories', () => {
    for (const name of HEAVY_FACTORIES) {
      expect((z as unknown as Record<string, unknown>)[name]).not.toBe(
        (realZ as unknown as Record<string, unknown>)[name],
      );
    }
  });
});

describe('internalZ', () => {
  it('has a parity case for every factory it defers', () => {
    const covered = new Set(factoryCases.map((c) => c.factory));
    expect([...LEAF_FACTORIES, ...HEAVY_FACTORIES].filter((name) => !covered.has(name))).toEqual([]);
  });

  it('defers only factories Zod has', () => {
    for (const name of [...LEAF_FACTORIES, ...HEAVY_FACTORIES]) {
      expect(typeof (realZ as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  describe.each(factoryCases)('z.$factory()', ({ build, valid, invalid }) => {
    it('returns a stand-in that builds nothing until it is used', () => {
      const schema = build(internalZ);
      expect(isLazy(schema)).toBe(true);
      expect(isBuilt(schema)).toBe(false);
    });

    it('accepts and rejects the same inputs as Zod, with the same issues', () => {
      const internal = build(internalZ);
      const eager = build(realZ);
      for (const input of [...valid, ...invalid]) expectSameResult(internal, eager, input);
    });

    it('converts to the same JSON Schema', () => {
      const eager = build(realZ);
      let expected: unknown;
      try {
        expected = toJSONSchema(eager);
      } catch (error) {
        expect(() => toJSONSchema(build(internalZ))).toThrow((error as Error).message);
        return;
      }
      expect(toJSONSchema(build(internalZ))).toEqual(expected);
    });
  });

  describe.each(chainCases)('$name', ({ build, valid, invalid }) => {
    it('accepts and rejects the same inputs as Zod, with the same issues', () => {
      const internal = build(internalZ);
      const eager = build(realZ);
      for (const input of [...valid, ...invalid]) expectSameResult(internal, eager, input);
    });
  });

  it('builds leaf children with their parent, so the built schema holds Zod’s own leaves', () => {
    const name = internalZ.string().min(1);
    const tags = internalZ.array(internalZ.string());
    const schema = internalZ.object({ name, tags });

    expect(schema.parse({ name: 'a', tags: [] })).toEqual({ name: 'a', tags: [] });

    expect(schema.shape.name).toBe(targetOf(name).materialize());
    expect(isLazy(schema.shape.name)).toBe(false);
    expect(isLazy(schema.shape.tags)).toBe(false);
    expect(schema.shape.tags.element).toBeInstanceOf(realZ.ZodString);
  });

  it('keeps compound children deferred until they are parsed', () => {
    const deep = internalZ.object({ issuer: internalZ.string() });
    const auth = internalZ.object({ deep });
    const schema = internalZ.object({ name: internalZ.string(), auth: auth.optional() });

    schema.parse({ name: 'a' });

    expect(isBuilt(auth)).toBe(true);
    expect(isBuilt(deep)).toBe(false);

    schema.parse({ name: 'a', auth: { deep: { issuer: 'x' } } });
    expect(isBuilt(deep)).toBe(true);
  });

  it('reuses a compound child that is already built', () => {
    const shared = internalZ.object({ id: internalZ.string() });
    shared.parse({ id: 'x' });
    const schema = internalZ.object({ shared });

    schema.parse({ shared: { id: 'y' } });

    expect(schema.shape.shared).toBe(targetOf(shared).materialize());
  });

  it('leaves Zod’s memoizer in place for every other schema', () => {
    const before = realZ.config().memoizer;
    internalZ.object({ a: internalZ.string() }).parse({ a: 'x' });
    expect(realZ.config().memoizer).toBe(before);

    type Node = { next?: Node };
    const node: realZ.ZodType<Node> = realZ.lazy(() => realZ.object({ next: node.optional() }));
    const cyclic: Node = {};
    cyclic.next = cyclic;
    const parsed = node.parse(cyclic);
    expect(parsed.next).toBe(parsed);
  });

  it('restores Zod’s memoizer when a build throws', () => {
    const before = realZ.config().memoizer;
    const broken = internalZ
      .object({ a: internalZ.string() })
      .refine(() => true)
      .pick({ a: true });
    expect(() => broken.parse({ a: 'x' })).toThrow('.pick() cannot be used on object schemas containing refinements');
    expect(realZ.config().memoizer).toBe(before);
  });

  it('answers introspection like the schema it stands for', () => {
    const base = internalZ.object({ kind: internalZ.literal('a'), size: internalZ.number().optional() });
    const union = internalZ.discriminatedUnion('kind', [base, internalZ.object({ kind: internalZ.literal('b') })]);
    const extended = base.extend({ label: internalZ.string().describe('Label') });

    expect(base).toBeInstanceOf(realZ.ZodObject);
    expect(internalZ.string()).toBeInstanceOf(realZ.ZodString);
    expect(internalZ.enum(['x', 'y']).options).toEqual(['x', 'y']);
    expect(Object.keys(base.shape)).toEqual(['kind', 'size']);
    expect(base._def.type).toBe('object');
    expect(base.shape.size.isOptional()).toBe(true);
    expect(extended.shape.label.description).toBe('Label');
    expect(union.parse({ kind: 'b' })).toEqual({ kind: 'b' });
    expect(realZ.fromJSONSchema(toJSONSchema(extended) as never).parse({ kind: 'a', label: 'l' })).toEqual({
      kind: 'a',
      label: 'l',
    });
  });

  it('carries the same types as z', () => {
    const schema = internalZ.object({ a: internalZ.string(), b: internalZ.number().optional() });
    type Parsed = internalZ.infer<typeof schema>;
    const value: Parsed = { a: 'x' };
    const typed: internalZ.ZodType<Parsed> = schema;
    expect(typed.parse(value)).toEqual({ a: 'x' });
  });
});
