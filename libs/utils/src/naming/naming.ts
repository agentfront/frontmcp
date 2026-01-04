/**
 * Shared naming and case conversion utilities.
 *
 * Provides functions for transforming strings between different naming conventions
 * (camelCase, snake_case, kebab-case, etc.) and generating unique identifiers.
 */

/**
 * Supported naming conventions for identifiers.
 */
export type NameCase = 'snake' | 'kebab' | 'dot' | 'camel';

/**
 * Split a string into words, handling camelCase, PascalCase, and delimiters.
 *
 * @param input - The string to split
 * @returns Array of words
 *
 * @example
 * splitWords("myFunctionName") // ["my", "Function", "Name"]
 * splitWords("my_function_name") // ["my", "function", "name"]
 * splitWords("MyClassName") // ["My", "Class", "Name"]
 */
export function splitWords(input: string): string[] {
  const parts: string[] = [];
  let buff = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const isAlphaNum = /[A-Za-z0-9]/.test(ch);
    if (!isAlphaNum) {
      if (buff) {
        parts.push(buff);
        buff = '';
      }
      continue;
    }
    if (buff && /[a-z]/.test(buff[buff.length - 1]) && /[A-Z]/.test(ch)) {
      parts.push(buff);
      buff = ch;
    } else {
      buff += ch;
    }
  }
  if (buff) parts.push(buff);
  return parts;
}

/**
 * Convert words to a specific naming case.
 *
 * @param words - Array of words to convert
 * @param kind - Target naming case
 * @returns Converted string
 *
 * @example
 * toCase(["my", "function"], "snake") // "my_function"
 * toCase(["my", "function"], "kebab") // "my-function"
 * toCase(["my", "function"], "camel") // "myFunction"
 * toCase(["My", "Class"], "dot") // "my.class"
 */
export function toCase(words: string[], kind: NameCase): string {
  const safe = words.filter(Boolean);
  switch (kind) {
    case 'snake':
      return safe.map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return safe.map((w) => w.toLowerCase()).join('-');
    case 'dot':
      return safe.map((w) => w.toLowerCase()).join('.');
    case 'camel':
      if (safe.length === 0) return '';
      return (
        safe[0].toLowerCase() +
        safe
          .slice(1)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join('')
      );
  }
}

/**
 * Get the separator character for a naming case.
 *
 * @param kind - The naming case
 * @returns Separator character ('_', '-', '.', or '' for camelCase)
 */
export function sepFor(kind: NameCase): string {
  return kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '';
}

/**
 * Generate a short hash (6 hex chars) from a string.
 * Uses djb2 algorithm for fast, reasonable distribution.
 *
 * @param s - String to hash
 * @returns 6-character hex string
 *
 * @example
 * shortHash("some-string") // "a1b2c3"
 */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return (h >>> 0).toString(16).slice(-6).padStart(6, '0');
}

/**
 * Ensure a name fits within a maximum length, using hash truncation if needed.
 * Preserves meaningful suffix while adding a hash for uniqueness.
 *
 * @param name - The name to potentially truncate
 * @param max - Maximum allowed length
 * @returns Name within max length, with hash if truncated
 *
 * @example
 * ensureMaxLen("short", 20) // "short"
 * ensureMaxLen("very-long-name-that-exceeds-limit", 20) // "very-a1b2c3-limit"
 */
export function ensureMaxLen(name: string, max: number): string {
  if (name.length <= max) return name;
  const hash = shortHash(name);
  const lastSep = Math.max(name.lastIndexOf('_'), name.lastIndexOf('-'), name.lastIndexOf('.'), name.lastIndexOf('/'));
  const tail = lastSep > 0 ? name.slice(lastSep + 1) : name.slice(-Math.max(3, Math.min(16, Math.floor(max / 4))));
  const budget = Math.max(1, max - (1 + hash.length + 1 + tail.length));
  const prefix = name.slice(0, budget);
  return `${prefix}-${hash}-${tail}`.slice(0, max);
}

/**
 * Convert a string to a valid identifier by removing invalid characters.
 * Replaces any run of invalid characters with a hyphen.
 *
 * @param name - The string to convert
 * @returns Valid identifier (alphanumeric, hyphens, underscores, max 64 chars)
 *
 * @example
 * idFromString("My Function Name!") // "My-Function-Name"
 * idFromString("foo@bar#baz") // "foo-bar-baz"
 */
export function idFromString(name: string): string {
  // Replace any invalid run with '-'
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '-');
  // Trim to max length and remove leading/trailing hyphens produced by cleaning
  return cleaned.replace(/^-+|-+$/g, '').slice(0, 64);
}
