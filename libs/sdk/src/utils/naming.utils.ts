// file: libs/sdk/src/utils/naming.utils.ts
// Shared naming and case conversion utilities for MCP-compliant identifiers

/**
 * Supported naming conventions for MCP identifiers
 */
export type NameCase = 'snake' | 'kebab' | 'dot' | 'camel';

// Allowed chars per MCP spec: a-zA-Z0-9 _ - . /
const MCP_ALLOWED = /[A-Za-z0-9_\-./]/;

/**
 * Split a string into words, handling camelCase, PascalCase, and delimiters.
 *
 * @example
 * splitWords("myFunctionName") => ["my", "Function", "Name"]
 * splitWords("my_function_name") => ["my", "function", "name"]
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
 * @example
 * toCase(["my", "function"], "snake") => "my_function"
 * toCase(["my", "function"], "camel") => "myFunction"
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
 */
export function sepFor(kind: NameCase): string {
  return kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '';
}

/**
 * Normalize a single segment (name part) to MCP-safe characters.
 */
export function normalizeSegment(raw: string, kind: NameCase): string {
  const words = splitWords(raw);
  let cased = toCase(words, kind);
  cased = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return cased || 'x';
}

/**
 * Normalize a provider ID to MCP-safe characters.
 */
export function normalizeProviderId(raw: string | undefined, kind: NameCase): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/\W+/);
  const cased = toCase(tokens, kind);
  const safe = [...cased].filter((ch) => MCP_ALLOWED.test(ch)).join('');
  return safe || undefined;
}

/**
 * Normalize an owner path (app:id/plugin:id) to the specified naming case.
 */
export function normalizeOwnerPath(ownerKey: string, kind: NameCase): string {
  const levels = ownerKey.split('/');
  const normLevels = levels.map((level) => {
    const parts = level.split(':'); // ["app","Portal"]
    return parts.map((p) => normalizeSegment(p, kind)).join(sepFor(kind));
  });
  if (kind === 'camel') return normLevels.map((seg) => seg.charAt(0).toLowerCase() + seg.slice(1)).join('');
  return normLevels.join(sepFor(kind));
}

/**
 * Generate a short hash (6 hex chars) from a string.
 * Uses djb2 algorithm for fast, reasonable distribution.
 */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return (h >>> 0).toString(16).slice(-6).padStart(6, '0');
}

/**
 * Ensure a name fits within a maximum length, using hash truncation if needed.
 * Preserves meaningful suffix while adding a hash for uniqueness.
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
