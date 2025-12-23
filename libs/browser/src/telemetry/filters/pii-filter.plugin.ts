// file: libs/browser/src/telemetry/filters/pii-filter.plugin.ts
/**
 * PII Filter Plugin
 *
 * Factory for creating custom PII filters.
 */

import type { PiiFilter, TelemetryEvent } from '../types';
import { deepApplyPatterns } from './pii-filter-chain';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating a custom PII filter plugin.
 */
export interface PiiFilterPluginOptions {
  /**
   * Unique name for this filter.
   */
  name: string;

  /**
   * Regular expression pattern to match.
   */
  pattern: RegExp;

  /**
   * Replacement string (supports regex capture groups).
   * Default: '[REDACTED]'
   */
  replacement?: string;

  /**
   * Filter priority (higher = applied first).
   * Default: 50 (custom filters run after built-in).
   */
  priority?: number;

  /**
   * Property paths to exclude from filtering.
   */
  allowlist?: string[];

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

/**
 * Options for creating a multi-pattern filter.
 */
export interface MultiPatternFilterOptions {
  /**
   * Unique name for this filter.
   */
  name: string;

  /**
   * Array of patterns with their replacements.
   */
  patterns: Array<{
    pattern: RegExp;
    replacement: string;
  }>;

  /**
   * Filter priority.
   */
  priority?: number;

  /**
   * Property paths to exclude.
   */
  allowlist?: string[];

  /**
   * Enable debug logging.
   */
  debug?: boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a custom PII filter plugin.
 *
 * Use this to create filters for custom sensitive data patterns.
 *
 * @example
 * ```typescript
 * // Filter custom secret format
 * const filter = createPiiFilterPlugin({
 *   name: 'custom-secret',
 *   pattern: /secret-[a-f0-9]{32}/gi,
 *   replacement: '[CUSTOM_SECRET]',
 * });
 *
 * // Filter with capture groups
 * const filter = createPiiFilterPlugin({
 *   name: 'employee-id',
 *   pattern: /employee_id=(\d+)/gi,
 *   replacement: 'employee_id=[REDACTED]',
 * });
 * ```
 */
export function createPiiFilterPlugin(options: PiiFilterPluginOptions): PiiFilter {
  const { name, pattern, replacement = '[REDACTED]', priority = 50, allowlist = [], debug = false } = options;

  const allowlistSet = new Set(allowlist);
  const patternConfig = [{ pattern, replacement }];

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[PiiFilter:${name}] ${message}`, data ?? '');
    }
  };

  log(`Created with pattern: ${pattern.source}`);

  return {
    name,
    priority,

    filter(event: TelemetryEvent): TelemetryEvent {
      const result = deepApplyPatterns(event, patternConfig, allowlistSet) as TelemetryEvent;
      log(`Filtered event ${event.id}`);
      return result;
    },
  };
}

/**
 * Create a filter with multiple patterns.
 *
 * @example
 * ```typescript
 * const filter = createMultiPatternFilter({
 *   name: 'company-secrets',
 *   patterns: [
 *     { pattern: /ACME-\d{8}/g, replacement: '[ACME_ID]' },
 *     { pattern: /internal-key-[a-z0-9]+/gi, replacement: '[INTERNAL_KEY]' },
 *   ],
 * });
 * ```
 */
export function createMultiPatternFilter(options: MultiPatternFilterOptions): PiiFilter {
  const { name, patterns, priority = 50, allowlist = [], debug = false } = options;

  const allowlistSet = new Set(allowlist);

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[PiiFilter:${name}] ${message}`, data ?? '');
    }
  };

  log(`Created with ${patterns.length} patterns`);

  return {
    name,
    priority,

    filter(event: TelemetryEvent): TelemetryEvent {
      const result = deepApplyPatterns(event, patterns, allowlistSet) as TelemetryEvent;
      log(`Filtered event ${event.id}`);
      return result;
    },
  };
}

/**
 * Create a filter that removes specific fields entirely.
 *
 * Instead of redacting values, this removes the fields completely.
 *
 * @example
 * ```typescript
 * const filter = createFieldRemovalFilter({
 *   name: 'remove-sensitive',
 *   fields: ['password', 'creditCard', 'ssn'],
 * });
 * ```
 */
export function createFieldRemovalFilter(options: {
  name: string;
  fields: string[];
  priority?: number;
  debug?: boolean;
}): PiiFilter {
  const { name, fields, priority = 50, debug = false } = options;

  const fieldSet = new Set(fields);

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[PiiFilter:${name}] ${message}`, data ?? '');
    }
  };

  const removeFields = <T>(value: T, path: string = ''): T => {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => removeFields(item, `${path}[${index}]`)) as T;
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        // Check if this field should be removed
        if (fieldSet.has(key)) {
          log(`Removed field: ${path ? `${path}.${key}` : key}`);
          continue;
        }
        const newPath = path ? `${path}.${key}` : key;
        result[key] = removeFields(val, newPath);
      }
      return result as T;
    }

    return value;
  };

  log(`Created with fields to remove: ${fields.join(', ')}`);

  return {
    name,
    priority,

    filter(event: TelemetryEvent): TelemetryEvent {
      return removeFields(event);
    },
  };
}

/**
 * Create a conditional filter that only applies to certain events.
 *
 * @example
 * ```typescript
 * const filter = createConditionalFilter({
 *   name: 'network-only',
 *   condition: (event) => event.category === 'network',
 *   innerFilter: createBuiltInPiiFilter(),
 * });
 * ```
 */
export function createConditionalFilter(options: {
  name: string;
  condition: (event: TelemetryEvent) => boolean;
  innerFilter: PiiFilter;
  priority?: number;
  debug?: boolean;
}): PiiFilter {
  const { name, condition, innerFilter, priority, debug = false } = options;

  const log = (message: string, data?: unknown) => {
    if (debug) {
      console.log(`[PiiFilter:${name}] ${message}`, data ?? '');
    }
  };

  return {
    name,
    priority: priority ?? innerFilter.priority,

    filter(event: TelemetryEvent): TelemetryEvent {
      if (condition(event)) {
        log(`Condition matched, applying inner filter`);
        return innerFilter.filter(event);
      }
      log(`Condition not matched, skipping`);
      return event;
    },
  };
}
