import { z } from '@frontmcp/lazy-zod';

/** The keys, types and lengths of an answer, so a model knows what to ask `result_query` for. */
export interface AnswerShape {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  /** A list's items, or a string's characters. */
  length?: number;
  /** An object's first 50 keys. */
  keys?: Record<string, AnswerShape>;
  /** The keys of an object past the first 50. */
  moreKeys?: number;
  /** A list's first item. */
  items?: AnswerShape;
}

/** What a folded answer sends in place of the answer. */
export interface FoldedAnswer {
  /** The start of the answer: the first items of each list and the first characters of each string. */
  preview: unknown;
  shape: AnswerShape;
  /** Reads the rest through `result_query`. */
  handle: string;
}

/** The folded form; a tool with an output schema folds only as `z.union([schema, foldedAnswerSchema])`. */
export const foldedAnswerSchema = z.object({
  preview: z.unknown().describe('The start of the answer: the first items of each list and characters of each string'),
  shape: z.record(z.string(), z.unknown()).describe("The answer's keys, types and lengths"),
  handle: z.string().describe('Read the rest of the answer with result_query and this handle'),
});

/** How many keys of an object the preview and the shape keep. */
const MAX_KEYS = 50;
/** How deep the preview and the shape go; deeper lists and objects are left empty, or undescribed. */
const MAX_DEPTH = 8;

export interface PreviewLimits {
  items: number;
  chars: number;
}

const encoder = new TextEncoder();

/** The size of a JSON value: UTF-8 bytes of its JSON. */
export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? '').byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first `length` UTF-16 units of `text`, one fewer when that would split a surrogate pair. */
export function textPrefix(text: string, length: number): string {
  if (text.length <= length) return text;
  const lastCode = text.charCodeAt(length - 1);
  return text.slice(0, lastCode >= 0xd800 && lastCode <= 0xdbff ? length - 1 : length);
}

/** The start of a JSON value: the first `items` of each list and `chars` of each string, the first 50 keys of each object. */
export function previewOf(value: unknown, limits: PreviewLimits, depth = 0): unknown {
  if (typeof value === 'string') return textPrefix(value, limits.chars);
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return [];
    return value.slice(0, limits.items).map((item) => previewOf(item, limits, depth + 1));
  }
  if (isRecord(value)) {
    if (depth >= MAX_DEPTH) return {};
    const entries = Object.entries(value).slice(0, MAX_KEYS);
    return Object.fromEntries(entries.map(([key, item]) => [key, previewOf(item, limits, depth + 1)]));
  }
  return value;
}

/** The shape of a JSON value: its type, the length of each list and string, and the keys of each object. */
export function shapeOf(value: unknown, depth = 0): AnswerShape {
  if (value === null) return { type: 'null' };
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (Array.isArray(value)) {
    const shape: AnswerShape = { type: 'array', length: value.length };
    if (value.length > 0 && depth < MAX_DEPTH) shape.items = shapeOf(value[0], depth + 1);
    return shape;
  }
  if (isRecord(value)) {
    if (depth >= MAX_DEPTH) return { type: 'object' };
    const keys = Object.keys(value);
    const described = keys.slice(0, MAX_KEYS).map((key) => [key, shapeOf(value[key], depth + 1)]);
    const shape: AnswerShape = { type: 'object', keys: Object.fromEntries(described) };
    if (keys.length > MAX_KEYS) shape.moreKeys = keys.length - MAX_KEYS;
    return shape;
  }
  return { type: typeof value === 'number' ? 'number' : 'boolean' };
}
