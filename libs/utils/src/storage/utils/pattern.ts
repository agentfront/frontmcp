/**
 * Pattern Matching Utilities
 *
 * Glob patterns for key matching: `*` matches any sequence, `?` matches one character, and a backslash makes the
 * next character literal, as in Redis `SCAN MATCH`, so `escapeGlob()` output means the same thing on every backend.
 * Matching runs without regular expressions, in time bounded by the key length times the pattern length.
 */

import { StoragePatternError } from '../errors';

/**
 * Maximum pattern length to prevent abuse.
 */
const MAX_PATTERN_LENGTH = 500;

/**
 * Maximum number of wildcard characters.
 */
const MAX_WILDCARDS = 20;

/**
 * Characters that need escaping in regex.
 */
const REGEX_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

type GlobToken = { kind: 'literal'; char: string } | { kind: 'one' } | { kind: 'star' };

/**
 * Check a pattern's length and wildcard count, then split it into tokens.
 * Consecutive `*` collapse into one. A backslash makes the next character literal; a trailing lone backslash is a
 * literal backslash.
 */
function tokenizeGlob(pattern: string): GlobToken[] {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new StoragePatternError(
      pattern.substring(0, 50) + '...',
      `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
    );
  }

  const tokens: GlobToken[] = [];
  let wildcardCount = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\' && i + 1 < pattern.length) {
      i++;
      tokens.push({ kind: 'literal', char: pattern[i] });
    } else if (char === '*') {
      wildcardCount++;
      if (tokens[tokens.length - 1]?.kind !== 'star') tokens.push({ kind: 'star' });
    } else if (char === '?') {
      wildcardCount++;
      tokens.push({ kind: 'one' });
    } else {
      tokens.push({ kind: 'literal', char });
    }
  }

  // The matcher no longer needs this limit to stay fast, but it is part of the documented pattern contract.
  if (wildcardCount > MAX_WILDCARDS) {
    throw new StoragePatternError(pattern, `Pattern has too many wildcards (max: ${MAX_WILDCARDS})`);
  }
  return tokens;
}

function matchesEverything(tokens: readonly GlobToken[]): boolean {
  return tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === 'star');
}

/**
 * Match tokens against a whole key with two pointers. On a mismatch, resume after the most recent `*`, which then
 * consumes one more character. Nothing earlier is revisited, so the work is at most key length times pattern length.
 */
function matchTokens(tokens: readonly GlobToken[], key: string): boolean {
  let k = 0;
  let t = 0;
  let starToken = -1;
  let starKey = 0;
  while (k < key.length) {
    const token = tokens[t];
    if (token !== undefined && (token.kind === 'one' || (token.kind === 'literal' && token.char === key[k]))) {
      t++;
      k++;
    } else if (token !== undefined && token.kind === 'star') {
      starToken = t;
      starKey = k;
      t++;
    } else if (starToken !== -1) {
      t = starToken + 1;
      starKey++;
      k = starKey;
    } else {
      return false;
    }
  }
  while (t < tokens.length && tokens[t].kind === 'star') t++;
  return t === tokens.length;
}

/**
 * Compile a glob pattern into a function that tests whole keys.
 *
 * Supports:
 * - `*` matches any sequence of characters (including empty)
 * - `?` matches exactly one character
 * - a backslash makes the next character literal, so `escapeGlob(value)` matches exactly `value`
 *
 * Unlike {@link globToRegex}, the matcher never backtracks: a pattern with many wildcards cannot stall the process.
 *
 * @param pattern - Glob pattern (e.g., "user:*:profile")
 * @returns A function that reports whether a key matches the whole pattern
 * @throws StoragePatternError if the pattern is too long or has too many wildcards
 *
 * @example
 * ```typescript
 * const isProfile = createGlobMatcher('user:*:profile');
 * isProfile('user:123:profile'); // true
 * isProfile('user:profile');     // false
 *
 * const exact = createGlobMatcher(`id:${escapeGlob('a*b')}`);
 * exact('id:a*b');  // true
 * exact('id:axxb'); // false
 * ```
 */
export function createGlobMatcher(pattern: string): (key: string) => boolean {
  const tokens = tokenizeGlob(pattern);
  if (matchesEverything(tokens)) {
    return () => true;
  }
  return (key: string) => matchTokens(tokens, key);
}

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports `*`, `?` and backslash escapes, as {@link createGlobMatcher} does. The result is a backtracking regular
 * expression; to test keys, use {@link createGlobMatcher} or {@link matchesPattern}, which do not backtrack.
 *
 * @param pattern - Glob pattern (e.g., "user:*:profile")
 * @returns RegExp for matching keys
 * @throws StoragePatternError if pattern is invalid or too complex
 *
 * @example
 * ```typescript
 * const regex = globToRegex('user:*:profile');
 * regex.test('user:123:profile');  // true
 * regex.test('user:abc:profile');  // true
 * regex.test('user:profile');      // false (missing segment)
 *
 * const regex2 = globToRegex('session:???');
 * regex2.test('session:abc');      // true
 * regex2.test('session:ab');       // false (too short)
 * regex2.test('session:abcd');     // false (too long)
 * ```
 */
export function globToRegex(pattern: string): RegExp {
  const tokens = tokenizeGlob(pattern);

  // Empty pattern and `*` match everything
  if (matchesEverything(tokens)) {
    return /^[\s\S]*$/;
  }

  let regexStr = '^';
  for (const token of tokens) {
    if (token.kind === 'star') {
      regexStr += '[\\s\\S]*';
    } else if (token.kind === 'one') {
      regexStr += '[\\s\\S]';
    } else {
      regexStr += token.char.replace(REGEX_SPECIAL_CHARS, '\\$&');
    }
  }
  regexStr += '$';

  try {
    return new RegExp(regexStr);
  } catch {
    throw new StoragePatternError(pattern, 'Failed to compile pattern to regex');
  }
}

/**
 * Test if a key matches a glob pattern.
 *
 * @param key - Key to test
 * @param pattern - Glob pattern
 * @returns true if key matches pattern
 *
 * @example
 * ```typescript
 * matchesPattern('user:123:profile', 'user:*:profile');  // true
 * matchesPattern('session:abc', 'session:???');         // true
 * matchesPattern('other:key', 'user:*');                // false
 * ```
 */
export function matchesPattern(key: string, pattern: string): boolean {
  return createGlobMatcher(pattern)(key);
}

/**
 * Check if a pattern is valid without throwing.
 *
 * @param pattern - Glob pattern to validate
 * @returns Object with valid flag and optional error message
 */
export function validatePattern(pattern: string): { valid: boolean; error?: string } {
  try {
    tokenizeGlob(pattern);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Invalid pattern',
    };
  }
}

/**
 * Escape a string for use as a literal in a glob pattern.
 * Escapes `*`, `?`, `[`, `]` and backslash (Redis `SCAN MATCH` reads `[` as the start of a character class). Every
 * matcher in this module, and Redis `SCAN MATCH`, reads the result as the literal string.
 *
 * @param literal - String to escape
 * @returns Escaped string safe for use in patterns
 *
 * @example
 * ```typescript
 * const id = 'user*123?';
 * const pattern = `key:${escapeGlob(id)}:*`;
 * // pattern = 'key:user\\*123\\?:*'
 * ```
 */
export function escapeGlob(literal: string): string {
  return literal.replace(/[*?[\]\\]/g, '\\$&');
}
