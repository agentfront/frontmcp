/**
 * @file primitive-filter.ts
 * @description Utility for applying include/exclude filters to named primitives
 * (tools, resources, prompts, etc.) loaded from external apps.
 */

import type { AppFilterConfig, PrimitiveFilterKey } from '../metadata/app-filter.metadata';

/**
 * Match a name against a glob-like pattern.
 * Supports `*` as wildcard for any sequence of characters.
 *
 * @example
 * ```ts
 * matchPattern('echo', 'echo')        // true
 * matchPattern('echo', 'ech*')        // true
 * matchPattern('dangerous-tool', 'dangerous-*') // true
 * matchPattern('echo', 'add')         // false
 * ```
 */
function matchPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return name === pattern;

  // Linear-time segment matching (avoids regex-based ReDoS)
  const segments = pattern.split('*');
  let pos = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0) {
      // First segment must match at the start
      if (!name.startsWith(seg)) return false;
      pos = seg.length;
    } else if (i === segments.length - 1) {
      // Last segment must match at the end
      if (!name.endsWith(seg)) return false;
      // Ensure no overlap with earlier matched portion
      if (name.length - seg.length < pos) return false;
    } else {
      // Middle segments: find next occurrence after current position
      const idx = name.indexOf(seg, pos);
      if (idx === -1) return false;
      pos = idx + seg.length;
    }
  }

  return true;
}

/**
 * Check if a name matches any pattern in an array.
 */
function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchPattern(name, p));
}

/**
 * Whether `filter` lets the primitive named `name` of `primitiveType` through.
 *
 * - `default: 'include'` (default): included unless it matches an `exclude` pattern
 * - `default: 'exclude'`: excluded unless it matches an `include` pattern
 */
export function isPrimitiveIncluded(
  name: string,
  primitiveType: PrimitiveFilterKey,
  config?: AppFilterConfig,
): boolean {
  if (!config) return true;
  if ((config.default ?? 'include') === 'include') {
    return !matchesAny(name, config.exclude?.[primitiveType] ?? []);
  }
  return matchesAny(name, config.include?.[primitiveType] ?? []);
}

/**
 * Apply include/exclude filtering to an array of named items (see {@link isPrimitiveIncluded}).
 *
 * @param items - Array of items with a `name` property
 * @param primitiveType - The primitive type key (e.g., 'tools', 'resources')
 * @param config - Optional filter configuration
 * @returns Filtered array of items
 */
export function applyPrimitiveFilter<T extends { name: string }>(
  items: T[],
  primitiveType: PrimitiveFilterKey,
  config?: AppFilterConfig,
): T[] {
  return items.filter((item) => isPrimitiveIncluded(item.name, primitiveType, config));
}
