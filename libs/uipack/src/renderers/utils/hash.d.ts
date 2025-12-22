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
export declare function hashString(source: string): string;
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
export declare function hashCombined(...values: unknown[]): string;
/**
 * Check if a string likely represents a hash (short alphanumeric).
 *
 * @param value - Value to check
 * @returns True if it looks like a hash
 */
export declare function isHash(value: string): boolean;
//# sourceMappingURL=hash.d.ts.map
