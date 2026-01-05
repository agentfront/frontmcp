/**
 * Pattern Matching Utilities
 *
 * Convert glob patterns to regex for key matching.
 * Includes ReDoS protection to prevent denial-of-service attacks.
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
const REGEX_SPECIAL_CHARS = /[.+^${}()|[\]\\]/g;

/**
 * Convert a glob pattern to a RegExp.
 *
 * Supports:
 * - `*` matches any sequence of characters (including empty)
 * - `?` matches exactly one character
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
  // Validate pattern length
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new StoragePatternError(
      pattern.substring(0, 50) + '...',
      `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
    );
  }

  // Count wildcards for ReDoS protection
  const wildcardCount = (pattern.match(/[*?]/g) || []).length;
  if (wildcardCount > MAX_WILDCARDS) {
    throw new StoragePatternError(pattern, `Pattern has too many wildcards (max: ${MAX_WILDCARDS})`);
  }

  // Empty pattern matches everything
  if (pattern === '' || pattern === '*') {
    return /^.*$/;
  }

  // Convert glob to regex
  let regexStr = '^';
  let prevChar = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    switch (char) {
      case '*':
        // Collapse consecutive * into one
        if (prevChar !== '*') {
          regexStr += '.*';
        }
        break;
      case '?':
        regexStr += '.';
        break;
      default:
        // Escape special regex characters
        regexStr += char.replace(REGEX_SPECIAL_CHARS, '\\$&');
    }

    prevChar = char;
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
  const regex = globToRegex(pattern);
  return regex.test(key);
}

/**
 * Check if a pattern is valid without throwing.
 *
 * @param pattern - Glob pattern to validate
 * @returns Object with valid flag and optional error message
 */
export function validatePattern(pattern: string): { valid: boolean; error?: string } {
  try {
    globToRegex(pattern);
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
 * Escapes * and ? characters.
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
  return literal.replace(/[*?\\]/g, '\\$&');
}
