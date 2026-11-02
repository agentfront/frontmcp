import { InvalidInputError } from '@frontmcp/sdk';

import { textPrefix } from './folded-answer';
import { ResultPathNotFoundError } from './result-handles.errors';

/** How many list items `result_query` reads when no `limit` is given. */
export const DEFAULT_ITEM_LIMIT = 20;
/** How many characters of a string `result_query` reads when no `limit` is given. */
export const DEFAULT_CHAR_LIMIT = 2000;

export type PathSegment = string | number;

export interface ResultQuery {
  path?: string;
  offset?: number;
  limit?: number;
  page?: number;
  fields?: string[];
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

function valueAt(result: unknown, path: string): unknown {
  let node = result;
  for (const segment of parseResultPath(path)) {
    const child = childOf(node, segment);
    if (!child.found) throw new ResultPathNotFoundError(path);
    node = child.value;
  }
  return node;
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

/** The value at `path`: a range of a list's items or a string's characters, `fields` kept of each object. */
export function queryResult(result: unknown, query: ResultQuery): ResultSlice {
  const path = query.path ?? '$';
  const value = valueAt(result, path);
  if (Array.isArray(value)) {
    const { offset, limit } = rangeOf(query, DEFAULT_ITEM_LIMIT);
    const items = value.slice(offset, offset + limit).map((item) => project(item, query.fields));
    return sliced(path, items, value.length, offset, items.length);
  }
  if (typeof value === 'string') {
    const { offset, limit } = rangeOf(query, DEFAULT_CHAR_LIMIT);
    const text = textPrefix(value.slice(offset), limit);
    return sliced(path, text, value.length, offset, text.length);
  }
  return { path, value: project(value, query.fields) };
}
