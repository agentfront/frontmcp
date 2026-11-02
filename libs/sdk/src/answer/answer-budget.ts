// file: libs/sdk/src/answer/answer-budget.ts

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult, ReadResourceResult } from '@frontmcp/protocol';

import { withUndeclaredKeysAllowed, type BudgetListPolicy, type OutputBudget } from '../common/metadata/output-policy';

/** The `_meta` key of the note on what a budget left out of an answer. */
export const BUDGET_META_KEY = 'frontmcp/budget';

/** One part of an answer a budget left out. */
export interface BudgetOmission {
  /** The resource content it was cut from, for a resource read. */
  uri?: string;
  /** Where, as a JSON path into the answer (`$.items`, `$.pages[0].body`); `$` is the whole text. */
  path: string;
  /** List items left out. */
  items?: number;
  /** The list's length before. */
  of?: number;
  /** Characters left out at the end of a string. */
  chars?: number;
}

/** The note `_meta['frontmcp/budget']` carries. */
export interface BudgetNote {
  maxBytes: number;
  lists: BudgetListPolicy;
  omitted: BudgetOmission[];
}

interface Fitted<T> {
  value: T;
  omitted: BudgetOmission[];
}

interface FitContext {
  lists: BudgetListPolicy;
  omitted: BudgetOmission[];
}

const NOTED_OMISSIONS = 5;
const listedSchemaParsers = new WeakMap<object, z.ZodType | Error>();
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const encoder = new TextEncoder();

function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}

function jsonBytes(value: unknown): number {
  return utf8Bytes(JSON.stringify(value) ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first `length` UTF-16 units of `text`, one fewer when that would split a surrogate pair. */
function prefixOf(text: string, length: number): string {
  const lastCode = text.charCodeAt(length - 1);
  const splitsPair = length > 0 && lastCode >= 0xd800 && lastCode <= 0xdbff;
  return text.slice(0, splitsPair ? length - 1 : length);
}

/** The longest prefix of `text` whose size, as `sizeOf` measures it, is within `allowance`. */
function longestPrefix(text: string, allowance: number, sizeOf: (prefix: string) => number): string {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizeOf(prefixOf(text, middle)) <= allowance) low = middle;
    else high = middle - 1;
  }
  return prefixOf(text, low);
}

function childPath(path: string, key: string): string {
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function fitNode(node: unknown, size: number, allowance: number, path: string, context: FitContext): unknown {
  if (size <= allowance) return node;
  if (typeof node === 'string') return fitString(node, allowance, path, context);
  if (Array.isArray(node)) return fitList(node, allowance, path, context);
  if (isRecord(node)) return fitRecord(node, size, allowance, path, context);
  return node;
}

function fitString(text: string, allowance: number, path: string, context: FitContext): string {
  const kept = longestPrefix(text, allowance, jsonBytes);
  context.omitted.push({ path, chars: text.length - kept.length });
  return kept;
}

/** Keeps whole items from the end `context.lists` names, as many as fit, in their order. */
function fitList(items: unknown[], allowance: number, path: string, context: FitContext): unknown[] {
  if (items.length === 0) return items;
  const sizes = items.map(jsonBytes);
  const indexes = items.map((_, index) => index);
  const preferred = context.lists === 'keep-newest' ? indexes.reverse() : indexes;
  const kept: number[] = [];
  let used = 2;
  for (const index of preferred) {
    const added = sizes[index] + (kept.length > 0 ? 1 : 0);
    if (used + added > allowance) break;
    used += added;
    kept.push(index);
  }
  if (kept.length === 0) {
    const [first] = preferred;
    if (items.length > 1) context.omitted.push({ path, items: items.length - 1, of: items.length });
    return [fitNode(items[first], sizes[first], allowance - 2, `${path}[0]`, context)];
  }
  context.omitted.push({ path, items: items.length - kept.length, of: items.length });
  return kept.sort((left, right) => left - right).map((index) => items[index]);
}

/** Shrinks the largest values first, until the record fits. */
function fitRecord(
  record: Record<string, unknown>,
  size: number,
  allowance: number,
  path: string,
  context: FitContext,
): Record<string, unknown> {
  const entries = Object.entries(record);
  const sizes = entries.map(([, value]) => jsonBytes(value));
  const largestFirst = entries.map((_, index) => index).sort((left, right) => sizes[right] - sizes[left]);
  const fitted = { ...record };
  let total = size;
  for (const index of largestFirst) {
    if (total <= allowance) break;
    const [key, value] = entries[index];
    const shrunk = fitNode(
      value,
      sizes[index],
      Math.max(sizes[index] - (total - allowance), 0),
      childPath(path, key),
      context,
    );
    if (shrunk === value) continue;
    total -= sizes[index] - jsonBytes(shrunk);
    fitted[key] = shrunk;
  }
  return fitted;
}

/**
 * Fit a JSON value to `maxBytes` of UTF-8 JSON without cutting inside it: whole list items are left
 * out (from the start for `'keep-newest'`, from the end for `'keep-oldest'`), and long strings lose
 * their end, largest values first. A value only numbers, booleans and keys make up stays over.
 */
export function fitJsonToBudget(
  value: unknown,
  maxBytes: number,
  lists: BudgetListPolicy = 'keep-newest',
): Fitted<unknown> {
  const context: FitContext = { lists, omitted: [] };
  const size = jsonBytes(value);
  if (size <= maxBytes) return { value, omitted: [] };
  return { value: fitNode(value, size, maxBytes, '$', context), omitted: context.omitted };
}

function parseJsonText(text: string): unknown {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Fit a text to `maxBytes`: JSON text as {@link fitJsonToBudget} does, other text by cutting its end. */
function fitTextToBudget(text: string, maxBytes: number, lists: BudgetListPolicy): Fitted<string> {
  if (utf8Bytes(text) <= maxBytes) return { value: text, omitted: [] };
  const json = parseJsonText(text);
  if (json !== undefined) {
    const fitted = fitJsonToBudget(json, maxBytes, lists);
    return { value: JSON.stringify(fitted.value), omitted: fitted.omitted };
  }
  const kept = longestPrefix(text, maxBytes, utf8Bytes);
  return { value: kept, omitted: [{ path: '$', chars: text.length - kept.length }] };
}

function describeOmission(omission: BudgetOmission, lists: BudgetListPolicy): string {
  const where = omission.path === '$' ? 'the answer' : omission.path;
  if (omission.items !== undefined) {
    const end = lists === 'keep-newest' ? 'first' : 'last';
    return `the ${end} ${omission.items} of ${omission.of} items of ${where}`;
  }
  return `the last ${omission.chars} characters of ${where}`;
}

/** The text line that tells the model what the budget left out. */
function describeBudgetNote(note: BudgetNote): string {
  const described = note.omitted.slice(0, NOTED_OMISSIONS).map((omission) => describeOmission(omission, note.lists));
  const more = note.omitted.length - described.length;
  if (more > 0) described.push(`${more} more parts listed in _meta["${BUDGET_META_KEY}"]`);
  return `This answer was shortened to fit its ${note.maxBytes}-byte budget: left out ${described.join('; ')}.`;
}

function addOmissions(omitted: BudgetOmission[], added: BudgetOmission[]): void {
  const known = new Set(omitted.map((omission) => JSON.stringify(omission)));
  omitted.push(...added.filter((omission) => !known.has(JSON.stringify(omission))));
}

/**
 * A tool answer fitted to its budget, or `undefined` when it already fits. `structuredContent` and
 * each text content are fitted alike, so a text that repeats `structuredContent` still repeats it;
 * images, audio and resources are left alone. The note goes to `_meta` and a last text content.
 */
export function fitToolAnswer(result: CallToolResult, budget: OutputBudget): CallToolResult | undefined {
  const lists = budget.lists ?? 'keep-newest';
  const omitted: BudgetOmission[] = [];
  let changed = false;
  let structuredContent = result.structuredContent;
  const structuredText = structuredContent === undefined ? undefined : JSON.stringify(structuredContent);
  let fittedStructuredText: string | undefined;
  if (structuredContent !== undefined && structuredText !== undefined && utf8Bytes(structuredText) > budget.maxBytes) {
    const fitted = fitJsonToBudget(structuredContent, budget.maxBytes, lists);
    structuredContent = fitted.value as Record<string, unknown>;
    fittedStructuredText = JSON.stringify(structuredContent);
    omitted.push(...fitted.omitted);
    changed = true;
  }

  const content = result.content.map((block) => {
    if (block.type !== 'text') return block;
    if (fittedStructuredText !== undefined && block.text === structuredText)
      return { ...block, text: fittedStructuredText };
    const fitted = fitTextToBudget(block.text, budget.maxBytes, lists);
    if (fitted.value === block.text) return block;
    addOmissions(omitted, fitted.omitted);
    changed = true;
    return { ...block, text: fitted.value };
  });
  if (!changed) return undefined;
  if (omitted.length === 0) return { ...result, content };

  const note: BudgetNote = { maxBytes: budget.maxBytes, lists, omitted };
  return {
    ...result,
    content: [...content, { type: 'text', text: describeBudgetNote(note) }],
    ...(structuredContent !== undefined && { structuredContent }),
    _meta: { ...result._meta, [BUDGET_META_KEY]: note },
  };
}

/**
 * A resource read fitted to its budget, or `undefined` when it already fits. Each text content is
 * fitted; HTML (a widget) and blobs are left alone. The note goes to `_meta` and a last text content.
 */
export function fitResourceAnswer(result: ReadResourceResult, budget: OutputBudget): ReadResourceResult | undefined {
  const lists = budget.lists ?? 'keep-newest';
  const omitted: BudgetOmission[] = [];
  let changed = false;
  const contents = result.contents.map((content) => {
    if (!('text' in content) || typeof content.text !== 'string' || content.mimeType?.startsWith('text/html')) {
      return content;
    }
    const fitted = fitTextToBudget(content.text, budget.maxBytes, lists);
    if (fitted.value === content.text) return content;
    omitted.push(...fitted.omitted.map((omission) => ({ uri: content.uri, ...omission })));
    changed = true;
    return { ...content, text: fitted.value };
  });
  if (!changed) return undefined;
  if (omitted.length === 0) return { ...result, contents };

  const note: BudgetNote = { maxBytes: budget.maxBytes, lists, omitted };
  const noteUri = omitted[0].uri ?? result.contents[0].uri;
  return {
    ...result,
    contents: [...contents, { uri: noteUri, mimeType: 'text/plain', text: describeBudgetNote(note) }],
    _meta: { ...result._meta, [BUDGET_META_KEY]: note },
  };
}

function parserOf(outputSchema: Record<string, unknown>): z.ZodType | Error {
  const known = listedSchemaParsers.get(outputSchema);
  if (known) return known;
  let parser: z.ZodType | Error;
  try {
    parser = z.fromJSONSchema(
      withUndeclaredKeysAllowed(outputSchema) as Parameters<typeof z.fromJSONSchema>[0],
      { defaultTarget: 'draft-2020-12' } as Parameters<typeof z.fromJSONSchema>[1],
    );
  } catch (error) {
    parser = error instanceof Error ? error : new Error(String(error));
  }
  listedSchemaParsers.set(outputSchema, parser);
  return parser;
}

/**
 * Why a fitted `structuredContent` no longer matches the `outputSchema` a client validates it
 * against (a cut below `minItems`, a shortened tuple or pattern), or `undefined` when it matches.
 */
export function outputSchemaMismatch(
  outputSchema: Record<string, unknown>,
  structuredContent: unknown,
): string | undefined {
  const parser = parserOf(outputSchema);
  if (parser instanceof Error) return `the schema could not be checked: ${parser.message}`;
  const parsed = parser.safeParse(structuredContent);
  if (parsed.success) return undefined;
  const [issue] = parsed.error.issues;
  return `${['$', ...issue.path.map(String)].join('.')}: ${issue.message}`;
}
