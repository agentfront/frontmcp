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

  // Convert glob pattern to regex: escape special chars, replace * with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

/**
 * Check if a name matches any pattern in an array.
 */
function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((p) => matchPattern(name, p));
}

/**
 * Apply include/exclude filtering to an array of named items.
 *
 * Filtering logic:
 * - `default: 'include'` (default): item is included unless it matches an `exclude` pattern
 * - `default: 'exclude'`: item is excluded unless it matches an `include` pattern
 * - If both `include` and `exclude` match, `exclude` takes precedence when default is 'include',
 *   and `include` takes precedence when default is 'exclude'
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
  if (!config) return items;

  const defaultMode = config.default ?? 'include';
  const includePatterns = config.include?.[primitiveType];
  const excludePatterns = config.exclude?.[primitiveType];

  // No patterns for this type — use default mode
  if (!includePatterns?.length && !excludePatterns?.length) {
    // If default is 'exclude' and no include patterns exist for this type,
    // check if there are ANY include patterns at all. If the entire include
    // map is empty, default behavior applies (exclude all).
    if (defaultMode === 'exclude') {
      return [];
    }
    return items;
  }

  return items.filter((item) => {
    const matchesInclude = includePatterns?.length ? matchesAny(item.name, includePatterns) : false;
    const matchesExclude = excludePatterns?.length ? matchesAny(item.name, excludePatterns) : false;

    if (defaultMode === 'include') {
      // Include by default, exclude wins over include
      if (matchesExclude) return false;
      return true;
    } else {
      // Exclude by default, include wins over exclude
      if (matchesInclude) return true;
      return false;
    }
  });
}
