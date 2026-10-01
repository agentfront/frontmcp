/**
 * Read a literal out of the `@FrontMcp({...})` argument in the entry's source,
 * for when the build cannot evaluate the entry to read its metadata.
 *
 * The Cloudflare build refuses a `redis` it cannot prove is the HTTP-only
 * `vercel-kv` provider (the TCP client cannot run on Workers). When the entry
 * could not be evaluated, the only thing it had to go on was that a `redis` key
 * exists — so it refused `redis: { provider: 'vercel-kv' }` with an error that
 * told the user to write exactly that (#680). A literal in the source settles
 * it without evaluating anything.
 *
 * This is a small tokenizer, not a parser: it skips comments and strings,
 * tracks nesting, and only answers when the value is written as a literal.
 * Anything computed (a variable, a ternary, a call, a template with `${}`)
 * yields `undefined`, which callers treat as "unknown".
 */
import * as fs from 'fs';

type Token = { kind: 'punct'; value: string } | { kind: 'ident'; value: string } | { kind: 'string'; value?: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end + 1;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let value = '';
      let literal = true;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === '\\') {
          value += source[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (ch === '`' && source[j] === '$' && source[j + 1] === '{') literal = false;
        value += source[j];
        j++;
      }
      tokens.push({ kind: 'string', value: literal ? value : undefined });
      i = j + 1;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      tokens.push({ kind: 'ident', value: source.slice(i, j) });
      i = j;
    } else {
      tokens.push({ kind: 'punct', value: ch });
      i++;
    }
  }
  return tokens;
}

const OPEN = new Set(['{', '(', '[']);
const CLOSE = new Set(['}', ')', ']']);

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punct' && token.value === value;
}

/**
 * Index of the first token of `key`'s value in the object literal opening at
 * `open` (a `{` token), or -1 when the object has no such top-level key.
 */
function findPropertyValue(tokens: Token[], open: number, key: string): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'punct' && OPEN.has(token.value)) depth++;
    else if (token.kind === 'punct' && CLOSE.has(token.value)) {
      depth--;
      if (depth === 0) return -1;
    } else if (depth === 1 && (token.kind === 'ident' || token.kind === 'string') && token.value === key) {
      const previous = tokens[i - 1];
      const startsEntry = isPunct(previous, '{') || isPunct(previous, ',');
      if (startsEntry && isPunct(tokens[i + 1], ':')) return i + 2;
    }
  }
  return -1;
}

/** The literal string a value is written as (`'x'` or `'x' as const`), if it ends there. */
function literalString(tokens: Token[], index: number): string | undefined {
  const token = tokens[index];
  if (token?.kind !== 'string' || token.value === undefined) return undefined;
  let end = index + 1;
  if (tokens[end]?.kind === 'ident' && tokens[end].value === 'as' && tokens[end + 1]?.kind === 'ident') end += 2;
  const after = tokens[end];
  return isPunct(after, ',') || isPunct(after, '}') ? token.value : undefined;
}

/**
 * The string literal at `path` inside the first `@FrontMcp({...})` argument,
 * e.g. `['redis', 'provider']` for `@FrontMcp({ redis: { provider: 'vercel-kv' } })`.
 * Every step but the last must be an object literal.
 */
export function readDecoratorStringLiteral(source: string, path: readonly string[]): string | undefined {
  const tokens = tokenize(source);
  let open = -1;
  for (let i = 0; i + 3 < tokens.length; i++) {
    const name = tokens[i + 1];
    if (
      isPunct(tokens[i], '@') &&
      name.kind === 'ident' &&
      name.value === 'FrontMcp' &&
      isPunct(tokens[i + 2], '(') &&
      isPunct(tokens[i + 3], '{')
    ) {
      open = i + 3;
      break;
    }
  }
  if (open === -1 || path.length === 0) return undefined;

  for (let step = 0; step < path.length; step++) {
    const valueAt = findPropertyValue(tokens, open, path[step]);
    if (valueAt === -1) return undefined;
    if (step === path.length - 1) return literalString(tokens, valueAt);
    if (!isPunct(tokens[valueAt], '{')) return undefined;
    open = valueAt;
  }
  return undefined;
}

/** {@link readDecoratorStringLiteral} on the entry file; `undefined` when it cannot be read. */
export function readEntryDecoratorStringLiteral(entry: string, path: readonly string[]): string | undefined {
  let source: string;
  try {
    source = fs.readFileSync(entry, 'utf-8');
  } catch {
    return undefined;
  }
  return readDecoratorStringLiteral(source, path);
}
