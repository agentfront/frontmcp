import { InvalidInputError } from '@frontmcp/sdk';

import { textPrefix } from './folded-answer';
import { grepMatcher, type GrepQuery } from './grep-pattern';
import { ResultPathNotFoundError } from './result-handles.errors';

/** How many list items `result_query` reads when no `limit` is given. */
export const DEFAULT_ITEM_LIMIT = 20;
/** How many characters of a string `result_query` reads when no `limit` is given. */
export const DEFAULT_CHAR_LIMIT = 2000;

/** How deep `grep` looks into each item for strings, numbers and booleans. */
const MAX_GREP_DEPTH = 16;

export type PathSegment = string | number;

export type WhereScalar = string | number | boolean | null;

export type WhereOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'exists';

/** One comparison of a list item's value at `field` (the item itself when left out) with `value`. */
export interface WhereCondition {
  field?: string;
  op: WhereOperator;
  value?: WhereScalar | WhereScalar[];
}

export interface SortKey {
  field?: string;
  order?: 'asc' | 'desc';
}

export interface ResultQuery {
  path?: string;
  offset?: number;
  limit?: number;
  page?: number;
  fields?: string[];
  /** Keep the items that meet every condition. */
  where?: WhereCondition[];
  /** Keep the items with a match, or of a string the lines with one, as `{ line, text }`. */
  grep?: GrepQuery;
  sort?: SortKey[];
  /** Answer how many items are kept, in place of the items. */
  count?: boolean;
}

export interface ResultSlice {
  path: string;
  value: unknown;
  /** The length of the list, or of the string, the slice is from. */
  total?: number;
  offset?: number;
  /** Where the next slice starts, while the list or the string has more. */
  nextOffset?: number;
}

/** One step of a dot path: `.key`, `key` first, `[2]` or `["key"]`. */
const DOT_STEP = /\.?([^.[\]"]+)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/y;

function parsePointer(path: string): PathSegment[] {
  return path
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function parseQuotedKey(path: string, quoted: string): string {
  try {
    return JSON.parse(quoted) as string;
  } catch {
    throw new ResultPathNotFoundError(path);
  }
}

function parseDotPath(path: string, body: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const step = new RegExp(DOT_STEP.source, 'y');
  while (step.lastIndex < body.length) {
    const match = step.exec(body);
    if (!match) throw new ResultPathNotFoundError(path);
    const [, key, index, quoted] = match;
    if (key !== undefined) segments.push(key);
    else if (index !== undefined) segments.push(Number(index));
    else segments.push(parseQuotedKey(path, quoted));
  }
  return segments;
}

/** The steps of a `result_query` path: a JSON pointer (`/rows/2/title`) or a dot path (`$.rows[2].title`, `rows.2.title`). */
export function parseResultPath(path: string): PathSegment[] {
  if (path.startsWith('/')) return parsePointer(path);
  if (!path.startsWith('$')) return parseDotPath(path, path);
  const body = path.slice(1);
  if (body !== '' && !body.startsWith('.') && !body.startsWith('[')) throw new ResultPathNotFoundError(path);
  return parseDotPath(path, body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childOf(node: unknown, segment: PathSegment): { found: boolean; value?: unknown } {
  if (Array.isArray(node)) {
    const index = typeof segment === 'number' ? segment : /^\d+$/.test(segment) ? Number(segment) : -1;
    return index >= 0 && index < node.length ? { found: true, value: node[index] } : { found: false };
  }
  const key = String(segment);
  return isRecord(node) && Object.hasOwn(node, key) ? { found: true, value: node[key] } : { found: false };
}

function lookup(node: unknown, segments: PathSegment[]): { found: boolean; value?: unknown } {
  let value = node;
  for (const segment of segments) {
    const child = childOf(value, segment);
    if (!child.found) return child;
    value = child.value;
  }
  return { found: true, value };
}

function valueAt(result: unknown, path: string): unknown {
  const node = lookup(result, parseResultPath(path));
  if (!node.found) throw new ResultPathNotFoundError(path);
  return node.value;
}

function fieldPath(field: string | undefined): PathSegment[] {
  return field === undefined ? [] : parseResultPath(field);
}

function project(value: unknown, fields: string[] | undefined): unknown {
  if (!fields || !isRecord(value)) return value;
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]),
  );
}

function rangeOf(query: ResultQuery, defaultLimit: number): { offset: number; limit: number } {
  if (query.page !== undefined && query.offset !== undefined) {
    throw new InvalidInputError('Give result_query a page or an offset, not both');
  }
  const limit = query.limit ?? defaultLimit;
  return { offset: query.page !== undefined ? (query.page - 1) * limit : (query.offset ?? 0), limit };
}

function sliced(path: string, value: unknown, total: number, offset: number, read: number): ResultSlice {
  const next = offset + read;
  return { path, value, total, offset, ...(next < total && { nextOffset: next }) };
}

function isScalar(value: unknown): value is WhereScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function checkCondition({ op, value }: WhereCondition, index: number): void {
  if (
    op === 'exists'
      ? value === undefined || typeof value === 'boolean'
      : op === 'in'
        ? Array.isArray(value)
        : isScalar(value)
  ) {
    return;
  }
  const expected =
    op === 'exists'
      ? 'true, false or no value'
      : op === 'in'
        ? 'a list of values'
        : 'a string, a number, a boolean or null';
  throw new InvalidInputError(`where[${index}]: "${op}" takes ${expected}`);
}

function ordered(op: WhereOperator, actual: unknown, value: unknown): boolean {
  const comparable =
    (typeof actual === 'number' && typeof value === 'number') ||
    (typeof actual === 'string' && typeof value === 'string');
  if (!comparable) return false;
  const [left, right] = [actual as number | string, value as number | string];
  if (op === 'gt') return left > right;
  if (op === 'gte') return left >= right;
  if (op === 'lt') return left < right;
  return left <= right;
}

function meets(field: { found: boolean; value?: unknown }, { op, value }: WhereCondition): boolean {
  if (op === 'exists') return field.found === (value ?? true);
  if (!field.found) return op === 'ne';
  const actual = field.value;
  switch (op) {
    case 'eq':
      return actual === value;
    case 'ne':
      return actual !== value;
    case 'in':
      return (value as WhereScalar[]).includes(actual as WhereScalar);
    case 'contains':
      if (typeof actual === 'string') return typeof value === 'string' && actual.includes(value);
      return Array.isArray(actual) && actual.includes(value);
    case 'startsWith':
      return typeof actual === 'string' && typeof value === 'string' && actual.startsWith(value);
    case 'endsWith':
      return typeof actual === 'string' && typeof value === 'string' && actual.endsWith(value);
    default:
      return ordered(op, actual, value);
  }
}

function whereTest(conditions: WhereCondition[]): (item: unknown) => boolean {
  const checks = conditions.map((condition, index) => {
    checkCondition(condition, index);
    const segments = fieldPath(condition.field);
    return (item: unknown) => meets(lookup(item, segments), condition);
  });
  return (item) => checks.every((check) => check(item));
}

/** Whether a string, number or boolean in `value`, down to {@link MAX_GREP_DEPTH} levels, matches. */
function hasMatch(value: unknown, matches: (text: string) => boolean): boolean {
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop() as [unknown, number];
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      if (matches(String(node))) return true;
    } else if (typeof node === 'object' && node !== null && depth < MAX_GREP_DEPTH) {
      for (const child of Object.values(node)) stack.push([child, depth + 1]);
    }
  }
  return false;
}

function grepped(value: unknown[] | string, grep: GrepQuery): unknown[] {
  const matches = grepMatcher(grep);
  if (typeof value === 'string') {
    return value.split(/\r?\n/).flatMap((text, index) => (matches(text) ? [{ line: index + 1, text }] : []));
  }
  const segments = fieldPath(grep.field);
  return value.filter((item) => {
    const field = lookup(item, segments);
    return field.found && hasMatch(field.value, matches);
  });
}

const TYPE_RANK = { number: 0, string: 1, boolean: 2, null: 3, other: 4 };

function rankOf(value: unknown): number {
  if (value === null) return TYPE_RANK.null;
  const type = typeof value;
  return type === 'number' || type === 'string' || type === 'boolean' ? TYPE_RANK[type] : TYPE_RANK.other;
}

/** Numbers, then strings, booleans, null and the rest, `order` applied; an item with no value at the field goes last. */
function compareFields(a: { found: boolean; value?: unknown }, b: { found: boolean; value?: unknown }, sign: number) {
  if (!a.found || !b.found) return Number(!a.found) - Number(!b.found);
  const rank = rankOf(a.value) - rankOf(b.value);
  if (rank !== 0) return sign * rank;
  const [left, right] = [a.value as number | string | boolean, b.value as number | string | boolean];
  return typeof left === 'object' || left === right ? 0 : sign * (left < right ? -1 : 1);
}

function sorted(items: unknown[], keys: SortKey[]): unknown[] {
  const fields = keys.map((key) => ({ segments: fieldPath(key.field), sign: key.order === 'desc' ? -1 : 1 }));
  return items
    .map((item, index) => ({ item, index, values: fields.map(({ segments }) => lookup(item, segments)) }))
    .sort((a, b) => {
      for (const [at, { sign }] of fields.entries()) {
        const order = compareFields(a.values[at], b.values[at], sign);
        if (order !== 0) return order;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/** The items of the list at `path` that `where` and `grep` keep, sorted by `sort`: counted, or a range of them. */
function viewOf(path: string, value: unknown, query: ResultQuery): ResultSlice {
  const searchable = Array.isArray(value) || (typeof value === 'string' && query.grep !== undefined);
  if (!searchable) {
    throw new InvalidInputError(
      `where, sort and count read a list, and grep a list or the lines of a string: "${path}" is ${kindOf(value)}`,
    );
  }
  let items = query.grep ? grepped(value as unknown[] | string, query.grep) : (value as unknown[]);
  if (query.where) items = items.filter(whereTest(query.where));
  if (query.sort) items = sorted(items, query.sort);
  if (query.count) return { path, value: items.length };
  const { offset, limit } = rangeOf(query, DEFAULT_ITEM_LIMIT);
  const kept = items.slice(offset, offset + limit).map((item) => project(item, query.fields));
  return sliced(path, kept, items.length, offset, kept.length);
}

/**
 * The value at `path`: a range of a list's items or a string's characters, `fields` kept of each object. `where`,
 * `grep`, `sort` and `count` view a list (or, with `grep`, a string's lines) before the range is read.
 */
export function queryResult(result: unknown, query: ResultQuery): ResultSlice {
  const path = query.path ?? '$';
  const value = valueAt(result, path);
  const viewed = query.where !== undefined || query.grep !== undefined || query.sort !== undefined || query.count;
  if (Array.isArray(value) || viewed) return viewOf(path, value, query);
  if (typeof value === 'string') {
    const { offset, limit } = rangeOf(query, DEFAULT_CHAR_LIMIT);
    const text = textPrefix(value.slice(offset), limit);
    return sliced(path, text, value.length, offset, text.length);
  }
  return { path, value: project(value, query.fields) };
}
