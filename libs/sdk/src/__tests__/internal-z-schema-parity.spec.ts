/**
 * Every schema exported by `@frontmcp/utils`, `@frontmcp/auth` and `@frontmcp/sdk` validates the same inputs, with
 * the same issues and messages, whether its module builds it with `internalZ` or with the public `z`.
 */
import 'reflect-metadata';

import { eagerZ, isLazy, toJSONSchema, z, ZodType } from '@frontmcp/lazy-zod';

type Exports = Record<string, unknown>;
type Def = Record<string, unknown> & { type: string };
type ParseResult = { success: boolean; data?: unknown; error?: { issues: unknown[]; message: string } };
type Parser = {
  safeParse(input: unknown): ParseResult;
  safeParseAsync(input: unknown): Promise<ParseResult>;
  _zod: { def: Def; innerType?: unknown };
  format?: string | null;
  minLength?: number | null;
};

const ENTRY_POINTS = ['@frontmcp/utils', '@frontmcp/auth', '../index'];

function loadEntryPoints(): Record<string, Exports> {
  return Object.fromEntries(ENTRY_POINTS.map((entry) => [entry, require(entry) as Exports]));
}

let current: Record<string, Exports> = {};
jest.isolateModules(() => {
  current = loadEntryPoints();
});

let previous: Record<string, Exports> = {};
jest.isolateModules(() => {
  jest.doMock('@frontmcp/lazy-zod', () => {
    const actual = jest.requireActual('@frontmcp/lazy-zod');
    return { ...actual, internalZ: actual.z };
  });
  previous = loadEntryPoints();
});

function isSchema(value: unknown): value is Parser {
  return isLazy(value) || (value !== null && typeof value === 'object' && '_zod' in value);
}

const STRING_FORMATS: Record<string, string> = {
  url: 'https://example.com/path',
  email: 'user@example.com',
  uuid: '123e4567-e89b-42d3-a456-426614174000',
  datetime: '2020-01-01T00:00:00Z',
};

/** The objects a sample is still filling in, so a recursive schema's sample can refer back to one: a cyclic input. */
type Cycles = { open: Map<unknown, Record<string, unknown>>; closed: number };

function sample(schema: unknown, depth: number, cycles?: Cycles): unknown {
  if (depth > 10 || !isSchema(schema)) return undefined;
  const parser = schema as Parser;
  const def = parser._zod.def;
  const child = (key: string): unknown => sample(def[key], depth + 1, cycles);
  switch (def.type) {
    case 'string':
      return STRING_FORMATS[parser.format ?? ''] ?? 'sample'.padEnd(parser.minLength ?? 0, 'x');
    case 'number':
    case 'int':
      return 1;
    case 'boolean':
      return true;
    case 'bigint':
      return 1n;
    case 'date':
      return new Date(0);
    case 'null':
      return null;
    case 'any':
    case 'unknown':
      return 'value';
    case 'literal':
      return (def['values'] as unknown[])[0];
    case 'enum':
      return Object.values(def['entries'] as object)[0];
    case 'array':
      return [child('element')];
    case 'object':
      return sampleObject(parser, depth, cycles);
    case 'record':
      return { key: child('valueType') };
    case 'tuple':
      return (def['items'] as unknown[]).map((item) => sample(item, depth + 1, cycles));
    case 'union':
      return sampleUnion(def['options'] as unknown[], depth, cycles);
    case 'intersection':
      return { ...(child('left') as object), ...(child('right') as object) };
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
      return child('innerType');
    case 'pipe':
      return child('in');
    case 'lazy':
      return sample(parser._zod.innerType, depth + 1, cycles);
    case 'function':
      return () => undefined;
    default:
      return undefined;
  }
}

function sampleObject(parser: Parser, depth: number, cycles: Cycles | undefined): Record<string, unknown> {
  const open = cycles?.open.get(parser._zod);
  if (cycles && open) {
    cycles.closed++;
    return open;
  }
  const value: Record<string, unknown> = {};
  cycles?.open.set(parser._zod, value);
  for (const [key, field] of Object.entries(parser._zod.def['shape'] as Record<string, unknown>)) {
    value[key] = sample(field, depth + 1, cycles);
  }
  cycles?.open.delete(parser._zod);
  return value;
}

function sampleUnion(options: unknown[], depth: number, cycles: Cycles | undefined): unknown {
  for (const option of cycles ? options : []) {
    const closedBefore = cycles?.closed ?? 0;
    const value = sample(option, depth + 1, cycles);
    if ((cycles?.closed ?? 0) > closedBefore) return value;
  }
  return sample(options[0], depth + 1, cycles);
}

/** A sample of a recursive schema that refers back to itself, or `undefined` for a schema with no cycle to close. */
function cyclicSample(schema: Parser): unknown {
  const cycles: Cycles = { open: new Map(), closed: 0 };
  const value = sample(schema, 0, cycles);
  return cycles.closed > 0 ? value : undefined;
}

function inputsFor(schema: Parser): unknown[] {
  const base = sample(schema, 0);
  const inputs: unknown[] = [base, undefined, null, 'text', 42, true, {}, []];
  if (base !== null && typeof base === 'object' && !Array.isArray(base)) {
    for (const [key, value] of Object.entries(base)) {
      const { [key]: _removed, ...rest } = base as Record<string, unknown>;
      inputs.push(rest, { ...base, [key]: typeof value === 'string' ? 42 : 'wrong' });
    }
  }
  const cyclic = cyclicSample(schema);
  if (cyclic !== undefined) inputs.push(cyclic);
  return inputs;
}

function comparable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'function') return '[function]';
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => comparable(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, comparable(item, seen)]));
}

function describeResult(result: ParseResult): unknown {
  if (result.success) return { success: true, data: comparable(result.data) };
  return { success: false, issues: comparable(result.error?.issues), message: result.error?.message };
}

async function outcome(schema: Parser, input: unknown): Promise<unknown> {
  try {
    return describeResult(schema.safeParse(input));
  } catch (error) {
    if ((error as Error).message.includes('parseAsync')) return describeResult(await schema.safeParseAsync(input));
    return { threw: (error as Error).message };
  }
}

function attempt(read: () => unknown): unknown {
  try {
    return { value: comparable(read()) };
  } catch (error) {
    return { threw: (error as Error).message };
  }
}

type Derived = Record<string, () => Parser>;

/** What a consumer builds from an exported schema: the derived schemas must validate like the ones `main` derives. */
function derivedFrom(schema: Parser): Derived {
  const derived: Derived = {
    'optional()': () => (schema as unknown as eagerZ.ZodType).optional() as unknown as Parser,
    'array()': () => (schema as unknown as eagerZ.ZodType).array() as unknown as Parser,
    'or()': () => (schema as unknown as eagerZ.ZodType).or(z.null()) as unknown as Parser,
    'z.object({ field })': () => z.object({ field: schema as unknown as eagerZ.ZodType }) as unknown as Parser,
  };
  if (schema._zod.def.type !== 'object') return derived;
  const object = schema as unknown as eagerZ.ZodObject<eagerZ.ZodRawShape>;
  const [firstKey] = Object.keys(object.shape);
  const extra = { extra: z.string().optional() };
  const objectDerived: Derived = {
    'extend()': () => object.extend(extra) as unknown as Parser,
    'merge()': () => object.merge(z.object(extra)) as unknown as Parser,
    'partial()': () => object.partial() as unknown as Parser,
    'strict()': () => object.strict() as unknown as Parser,
    'z.object({ ...shape })': () => z.object({ ...object.shape, ...extra }) as unknown as Parser,
  };
  if (firstKey !== undefined) {
    objectDerived['pick()'] = () => object.pick({ [firstKey]: true }) as unknown as Parser;
    objectDerived['omit()'] = () => object.omit({ [firstKey]: true }) as unknown as Parser;
  }
  const discriminator = Object.keys(object.shape).find((key) => object.shape[key]._zod.def.type === 'literal');
  if (discriminator !== undefined) {
    objectDerived['z.discriminatedUnion()'] = () =>
      z.discriminatedUnion(discriminator, [
        object,
        z.object({ [discriminator]: z.literal('another option') }),
      ]) as unknown as Parser;
  }
  return { ...derived, ...objectDerived };
}

/** What a consumer reads from an exported schema without parsing with it. */
function introspection(schema: Parser): Record<string, unknown> {
  const zodSchema = schema as unknown as eagerZ.ZodType;
  const shape = schema._zod.def.type === 'object' ? (schema as unknown as eagerZ.ZodObject).shape : undefined;
  return {
    type: attempt(() => schema._zod.def.type),
    className: attempt(() => zodSchema.constructor.name),
    isZodType: attempt(() => schema instanceof ZodType),
    description: attempt(() => zodSchema.description),
    meta: attempt(() => zodSchema.meta()),
    isOptional: attempt(() => zodSchema.isOptional()),
    isNullable: attempt(() => zodSchema.isNullable()),
    shape: attempt(() => shape && Object.entries(shape).map(([key, field]) => [key, field._zod.def.type])),
    jsonSchema: attempt(() => toJSONSchema(zodSchema)),
    inputJsonSchema: attempt(() => toJSONSchema(zodSchema, { io: 'input' })),
  };
}

const cases = ENTRY_POINTS.flatMap((entry) =>
  Object.keys(previous[entry])
    .filter((name) => isSchema(previous[entry][name]))
    .map((name) => ({ entry, name })),
);

describe('exported schemas built with internalZ', () => {
  it('finds the exported schemas of every entry point', () => {
    for (const entry of ENTRY_POINTS) expect(cases.some((c) => c.entry === entry)).toBe(true);
  });

  it('compares the schemas internalZ builds with the ones the public z builds', () => {
    const deferred = (loaded: Record<string, Exports>) =>
      cases.filter(({ entry, name }) => isLazy(loaded[entry][name])).length;
    expect(deferred(current)).toBeGreaterThan(deferred(previous));
  });

  it.each(cases)('$entry $name validates the same inputs as before', async ({ entry, name }) => {
    const before = previous[entry][name] as Parser;
    const after = current[entry][name] as Parser;
    expect(isSchema(after)).toBe(true);
    for (const input of inputsFor(before)) {
      expect(await outcome(after, input)).toEqual(await outcome(before, input));
    }
  });

  it('also gives each recursive schema a cyclic input, which only Zod’s memoizer parses', () => {
    const recursive = cases.filter(({ entry, name }) => cyclicSample(previous[entry][name] as Parser) !== undefined);
    expect(recursive.map(({ name }) => name)).toContain('authoritiesPolicySchema');
  });

  it.each(cases)('$entry $name composes and converts like before', async ({ entry, name }) => {
    const before = previous[entry][name] as Parser;
    const after = current[entry][name] as Parser;
    expect(introspection(after)).toEqual(introspection(before));

    const zodJsonSchema = (schema: Parser) => attempt(() => eagerZ.toJSONSchema(schema as unknown as eagerZ.ZodType));
    const zodBefore = zodJsonSchema(before);
    if (!('threw' in (zodBefore as object))) expect(zodJsonSchema(after)).toEqual(zodBefore);

    const derivedBefore = derivedFrom(before);
    const derivedAfter = derivedFrom(after);
    expect(Object.keys(derivedAfter)).toEqual(Object.keys(derivedBefore));
    const inputs = inputsFor(before);
    for (const [label, derive] of Object.entries(derivedBefore)) {
      const derivedOutcome = async (make: () => Parser, input: unknown) => {
        try {
          return await outcome(make(), input);
        } catch (error) {
          return { threw: (error as Error).message };
        }
      };
      for (const input of [...inputs, [inputs[0]], { field: inputs[0] }]) {
        expect({ label, outcome: await derivedOutcome(derivedAfter[label], input) }).toEqual({
          label,
          outcome: await derivedOutcome(derive, input),
        });
      }
      expect({ label, jsonSchema: attempt(() => toJSONSchema(derivedAfter[label]() as never)) }).toEqual({
        label,
        jsonSchema: attempt(() => toJSONSchema(derive() as never)),
      });
    }
  });
});
