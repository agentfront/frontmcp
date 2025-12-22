/**
 * Hash Utilities for Renderer Caching
 *
 * Fast, non-cryptographic hashing for content-addressable cache keys.
 */

/**
 * Generate a fast hash string from source content.
 * Uses FNV-1a algorithm for good distribution and speed.
 *
 * @param source - String to hash
 * @returns Base36 encoded hash string
 *
 * @example
 * ```typescript
 * const hash = hashString('function Component() { return <div>Hello</div> }');
 * // Returns something like "1a2b3c4d"
 * ```
 */
export function hashString(source: string): string {
  // FNV-1a hash algorithm - fast and well-distributed
  let hash = 2166136261; // FNV offset basis

  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    // FNV prime for 32-bit: 16777619
    hash = (hash * 16777619) >>> 0; // Keep as unsigned 32-bit
  }

  return hash.toString(36);
}

/**
 * Generate a hash combining multiple values.
 * Useful for creating cache keys from multiple inputs.
 *
 * @param values - Values to combine into a hash
 * @returns Combined hash string
 *
 * @example
 * ```typescript
 * const key = hashCombined('template-source', { location: 'NYC' }, { temp: 72 });
 * ```
 */
export function hashCombined(...values: unknown[]): string {
  const combined = values
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    })
    .join('|');

  return hashString(combined);
}

/**
 * Check if a string likely represents a hash (short alphanumeric).
 *
 * @param value - Value to check
 * @returns True if it looks like a hash
 */
export function isHash(value: string): boolean {
  // Hash strings from hashString() are typically 6-8 characters of base36
  return /^[0-9a-z]{5,10}$/i.test(value);
}
