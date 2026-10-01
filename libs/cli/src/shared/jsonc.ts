/**
 * JSON-with-comments (JSONC) read/edit helpers for files the CLI rewrites in
 * place, such as `tsconfig.json`.
 *
 * TypeScript accepts comments and trailing commas in `tsconfig.json`, and most
 * real-world files have them. A plain `JSON.parse` failed on those files, the
 * failure read as "file not found", and `frontmcp init` overwrote the user's
 * file with the default one (#679). Edits are applied in place, so comments
 * and formatting the user wrote survive.
 */

import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type JSONPath,
  type ParseError,
} from 'jsonc-parser';

const BOM = '﻿';

export class JsoncParseError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${file} is not valid JSON: ${reason} at line ${line}, column ${column}`);
    this.name = 'JsoncParseError';
  }
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return { line, column };
}

/**
 * Parse JSONC text whose top level must be an object. Throws
 * {@link JsoncParseError} (with the first error's position) instead of
 * returning a partial value.
 */
export function parseJsoncObject(text: string, file: string): Record<string, unknown> {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const errors: ParseError[] = [];
  const value: unknown = parse(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0];
    const { line, column } = lineAndColumn(source, first.offset);
    throw new JsoncParseError(file, printParseErrorCode(first.error), line, column);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JsoncParseError(file, 'the top level is not an object', 1, 1);
  }
  return value as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Leaf paths where `after` differs from `before` (objects are walked, arrays compared whole). */
function collectChanges(
  before: unknown,
  after: unknown,
  at: JSONPath,
  out: Array<{ path: JSONPath; value: unknown }>,
): void {
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Object.keys(after)) collectChanges(before[key], after[key], [...at, key], out);
    return;
  }
  if (!sameJson(before, after)) out.push({ path: at, value: after });
}

function detectFormatting(text: string): FormattingOptions {
  const indent = /^([ \t]+)\S/m.exec(text)?.[1];
  if (indent?.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol: eolOf(text) };
  return { insertSpaces: true, tabSize: indent ? indent.length : 2, eol: eolOf(text) };
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Rewrite `text` so it holds `after`, touching only the keys whose values
 * differ from `before` (the parsed `text`). Keys `after` drops are left alone.
 * Comments, key order and formatting elsewhere are kept.
 */
export function updateJsoncText(text: string, before: Record<string, unknown>, after: Record<string, unknown>): string {
  const hasBom = text.startsWith(BOM);
  let source = hasBom ? text.slice(BOM.length) : text;
  const changes: Array<{ path: JSONPath; value: unknown }> = [];
  collectChanges(before, after, [], changes);
  const formattingOptions = detectFormatting(source);
  for (const change of changes) {
    source = applyEdits(source, modify(source, change.path, change.value, { formattingOptions }));
  }
  return hasBom ? BOM + source : source;
}
