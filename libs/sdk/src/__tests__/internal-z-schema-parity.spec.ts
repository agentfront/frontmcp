/**
 * Every schema exported by `@frontmcp/utils`, `@frontmcp/auth` and `@frontmcp/sdk` validates the same inputs, with
 * the same issues and messages, whether its module builds it with `internalZ` or with the public `z`.
 */
import 'reflect-metadata';

import { isLazy } from '@frontmcp/lazy-zod';

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

function sample(schema: unknown, depth: number): unknown {
  if (depth > 6 || !isSchema(schema)) return undefined;
  const parser = schema as Parser;
  const def = parser._zod.def;
  const child = (key: string): unknown => sample(def[key], depth + 1);
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
      return Object.fromEntries(
        Object.entries(def['shape'] as Record<string, unknown>).map(([key, value]) => [key, sample(value, depth + 1)]),
      );
    case 'record':
      return { key: child('valueType') };
    case 'tuple':
      return (def['items'] as unknown[]).map((item) => sample(item, depth + 1));
    case 'union':
      return sample((def['options'] as unknown[])[0], depth + 1);
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
      return sample(parser._zod.innerType, depth + 1);
    case 'function':
      return () => undefined;
    default:
      return undefined;
  }
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
});
