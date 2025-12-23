// file: libs/browser/src/telemetry/filters/pii-filter-chain.ts
/**
 * PII Filter Chain
 *
 * Priority-ordered filter chain for PII redaction.
 */

import type { PiiFilter, PiiFilterChainOptions, TelemetryEvent } from '../types';

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a PII filter chain.
 *
 * Filters are applied in priority order (highest first).
 *
 * @example
 * ```typescript
 * const filterChain = createPiiFilterChain({
 *   filters: [
 *     createBuiltInPiiFilter(),
 *     createPiiFilterPlugin({
 *       name: 'custom',
 *       pattern: /secret-\d+/g,
 *       replacement: '[CUSTOM]',
 *     }),
 *   ],
 * });
 *
 * const sanitizedEvent = filterChain(event);
 * ```
 */
export function createPiiFilterChain(options: PiiFilterChainOptions): (event: TelemetryEvent) => TelemetryEvent {
  const { filters, debug = false } = options;

  // Sort filters by priority (highest first)
  const sortedFilters = [...filters].sort((a, b) => b.priority - a.priority);

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[PiiFilterChain] ${message}`, data ?? '');
    }
  };

  log(
    `Created chain with ${sortedFilters.length} filters:`,
    sortedFilters.map((f) => f.name),
  );

  return (event: TelemetryEvent): TelemetryEvent => {
    let result = event;

    for (const filter of sortedFilters) {
      try {
        result = filter.filter(result);
      } catch (error) {
        log(`Filter "${filter.name}" failed:`, error);
        // Continue with unfiltered event on error
      }
    }

    return result;
  };
}

/**
 * Apply a pattern to a string value.
 */
export function applyPattern(value: string, pattern: RegExp, replacement: string): string {
  // Reset regex state for global patterns
  pattern.lastIndex = 0;
  return value.replace(pattern, replacement);
}

/**
 * Deep apply patterns to an object.
 *
 * Recursively applies patterns to all string values in an object.
 */
export function deepApplyPatterns<T>(
  value: T,
  patterns: Array<{ pattern: RegExp; replacement: string }>,
  allowlist: Set<string> = new Set(),
  path: string = '',
): T {
  if (value === null || value === undefined) {
    return value;
  }

  // Check allowlist
  if (allowlist.has(path)) {
    return value;
  }

  if (typeof value === 'string') {
    let result: string = value;
    for (const { pattern, replacement } of patterns) {
      result = applyPattern(result, pattern, replacement);
    }
    return result as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => deepApplyPatterns(item, patterns, allowlist, `${path}[${index}]`)) as T;
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const newPath = path ? `${path}.${key}` : key;
      result[key] = deepApplyPatterns(val, patterns, allowlist, newPath);
    }
    return result as T;
  }

  return value;
}

/**
 * Create a simple filter from a pattern.
 */
export function createPatternFilter(
  name: string,
  pattern: RegExp,
  replacement: string,
  priority: number = 0,
): PiiFilter {
  return {
    name,
    priority,
    filter(event: TelemetryEvent): TelemetryEvent {
      return deepApplyPatterns(event, [{ pattern, replacement }]) as TelemetryEvent;
    },
  };
}

/**
 * Compose multiple filter chains into one.
 */
export function composePiiFilters(
  ...chains: Array<(event: TelemetryEvent) => TelemetryEvent>
): (event: TelemetryEvent) => TelemetryEvent {
  return (event: TelemetryEvent): TelemetryEvent => {
    let result = event;
    for (const chain of chains) {
      result = chain(result);
    }
    return result;
  };
}
