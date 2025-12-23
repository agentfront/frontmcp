// file: libs/browser/src/telemetry/filters/built-in-filter.plugin.ts
/**
 * Built-in PII Filter Plugin
 *
 * Creates a PII filter using built-in patterns.
 */

import type { PiiFilter, TelemetryEvent } from '../types';
import { BUILTIN_PATTERNS, getBuiltinPatterns } from './built-in-patterns';
import { deepApplyPatterns } from './pii-filter-chain';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a built-in PII filter.
 */
export interface BuiltInPiiFilterOptions {
  /**
   * Specific pattern names to use.
   * If not provided, all built-in patterns are used.
   */
  patterns?: string[];

  /**
   * Property paths to exclude from filtering.
   * Uses dot notation (e.g., 'metadata.userId').
   */
  allowlist?: string[];

  /**
   * Filter priority (higher = applied first).
   * Default: 100 (built-in filters run first).
   */
  priority?: number;

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a built-in PII filter.
 *
 * Uses pre-defined patterns for common PII types like emails,
 * credit cards, phone numbers, API keys, etc.
 *
 * @example
 * ```typescript
 * // Use all built-in patterns
 * const filter = createBuiltInPiiFilter();
 *
 * // Use only specific patterns
 * const filter = createBuiltInPiiFilter({
 *   patterns: ['email', 'creditCard', 'ssn'],
 * });
 *
 * // Exclude certain fields from filtering
 * const filter = createBuiltInPiiFilter({
 *   allowlist: ['metadata.userId', 'context.sessionId'],
 * });
 * ```
 */
export function createBuiltInPiiFilter(options: BuiltInPiiFilterOptions = {}): PiiFilter {
  const { patterns: patternNames, allowlist = [], priority = 100, debug = false } = options;

  // Get patterns to use
  const patternsToUse = patternNames ? getBuiltinPatterns(patternNames) : BUILTIN_PATTERNS;

  // Convert to pattern format for deepApplyPatterns
  const patternConfigs = patternsToUse.map((p) => ({
    pattern: p.pattern,
    replacement: p.replacement ?? '[REDACTED]',
  }));

  // Create allowlist set
  const allowlistSet = new Set(allowlist);

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[BuiltInPiiFilter] ${message}`, data ?? '');
    }
  };

  log(
    `Created with ${patternsToUse.length} patterns:`,
    patternsToUse.map((p) => p.name),
  );

  return {
    name: 'built-in',
    priority,

    filter(event: TelemetryEvent): TelemetryEvent {
      const result = deepApplyPatterns(event, patternConfigs, allowlistSet) as TelemetryEvent;
      log(`Filtered event ${event.id}`);
      return result;
    },
  };
}

/**
 * Create a built-in PII filter for specific categories.
 *
 * Convenience factory for common use cases.
 */
export function createCategoryPiiFilter(
  category: 'credentials' | 'personal' | 'network' | 'all',
  options: Omit<BuiltInPiiFilterOptions, 'patterns'> = {},
): PiiFilter {
  const categoryPatterns: Record<string, string[]> = {
    credentials: ['apiKey', 'bearerToken', 'jwt', 'password', 'authHeader', 'awsKey', 'privateKey'],
    personal: ['email', 'creditCard', 'ssn', 'phone'],
    network: ['ipv4', 'ipv6'],
    all: [], // Empty means use all
  };

  const patterns = categoryPatterns[category];

  return createBuiltInPiiFilter({
    ...options,
    patterns: patterns.length > 0 ? patterns : undefined,
  });
}
