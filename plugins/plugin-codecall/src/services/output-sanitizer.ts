// file: libs/plugins/src/codecall/services/output-sanitizer.ts

/**
 * Output Sanitizer for CodeCall
 *
 * Sanitizes script outputs to prevent information leakage through:
 * - Error messages with stack traces or file paths
 * - Large outputs that could contain sensitive data
 * - Recursive structures that could cause DoS
 *
 * Security considerations:
 * - All sanitization is defensive (fail-safe)
 * - Outputs are truncated, not rejected
 * - Circular references are handled
 * - Prototype pollution is prevented
 */

/**
 * Configuration for output sanitization.
 */
export interface OutputSanitizerConfig {
  /**
   * Maximum depth for nested objects/arrays.
   * @default 10
   */
  maxDepth: number;

  /**
   * Maximum length for string values.
   * @default 10000
   */
  maxStringLength: number;

  /**
   * Maximum number of keys in an object.
   * @default 100
   */
  maxObjectKeys: number;

  /**
   * Maximum number of items in an array.
   * @default 1000
   */
  maxArrayLength: number;

  /**
   * Maximum total size of serialized output in bytes.
   * @default 1MB
   */
  maxTotalSize: number;

  /**
   * Remove error stack traces.
   * @default true
   */
  removeStackTraces: boolean;

  /**
   * Remove file paths from strings.
   * @default true
   */
  removeFilePaths: boolean;
}

/**
 * Default sanitization configuration.
 */
export const DEFAULT_SANITIZER_CONFIG: OutputSanitizerConfig = Object.freeze({
  maxDepth: 10,
  maxStringLength: 10000,
  maxObjectKeys: 100,
  maxArrayLength: 1000,
  maxTotalSize: 1024 * 1024, // 1MB
  removeStackTraces: true,
  removeFilePaths: true,
});

/**
 * Result of sanitization.
 */
export interface SanitizationResult<T> {
  /** Sanitized value */
  value: T;
  /** Whether any sanitization was applied */
  wasModified: boolean;
  /** Warnings about what was sanitized */
  warnings: string[];
}

/**
 * Sanitize output from CodeCall script execution.
 *
 * @param output - Raw output from script
 * @param config - Sanitization configuration
 * @returns Sanitized output with metadata
 */
export function sanitizeOutput<T = unknown>(
  output: unknown,
  config: Partial<OutputSanitizerConfig> = {},
): SanitizationResult<T> {
  const cfg = { ...DEFAULT_SANITIZER_CONFIG, ...config };
  const warnings: string[] = [];
  const seen = new WeakSet<object>();

  const result = sanitizeValue(output, cfg, warnings, seen, 0);

  // Check total size
  try {
    const serialized = JSON.stringify(result);
    if (serialized && serialized.length > cfg.maxTotalSize) {
      warnings.push(`Output truncated: exceeded max size of ${cfg.maxTotalSize} bytes`);
      return {
        value: { _truncated: true, _reason: 'Output exceeded maximum size' } as T,
        wasModified: true,
        warnings,
      };
    }
  } catch {
    // If we can't serialize, return a safe placeholder
    warnings.push('Output could not be serialized');
    return {
      value: { _error: 'Output could not be serialized' } as T,
      wasModified: true,
      warnings,
    };
  }

  return {
    value: result as T,
    wasModified: warnings.length > 0,
    warnings,
  };
}

/**
 * Recursively sanitize a value.
 */
function sanitizeValue(
  value: unknown,
  config: OutputSanitizerConfig,
  warnings: string[],
  seen: WeakSet<object>,
  depth: number,
): unknown {
  // Check depth
  if (depth > config.maxDepth) {
    warnings.push(`Max depth of ${config.maxDepth} exceeded`);
    return '[max depth exceeded]';
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle primitives
  if (typeof value === 'string') {
    return sanitizeString(value, config, warnings);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (typeof value === 'function') {
    warnings.push('Function removed from output');
    return '[function]';
  }

  // Handle objects
  if (typeof value === 'object') {
    // Check for circular references
    if (seen.has(value)) {
      warnings.push('Circular reference detected');
      return '[circular]';
    }
    seen.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      return sanitizeArray(value, config, warnings, seen, depth);
    }

    // Handle Error objects
    if (value instanceof Error) {
      return sanitizeError(value, config, warnings);
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString();
    }

    // Handle RegExp objects
    if (value instanceof RegExp) {
      return value.toString();
    }

    // Handle Map
    if (value instanceof Map) {
      const obj: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v] of value) {
        if (count >= config.maxObjectKeys) {
          warnings.push(`Map truncated: exceeded ${config.maxObjectKeys} keys`);
          break;
        }
        obj[String(k)] = sanitizeValue(v, config, warnings, seen, depth + 1);
        count++;
      }
      return obj;
    }

    // Handle Set
    if (value instanceof Set) {
      const arr: unknown[] = [];
      let count = 0;
      for (const item of value) {
        if (count >= config.maxArrayLength) {
          warnings.push(`Set truncated: exceeded ${config.maxArrayLength} items`);
          break;
        }
        arr.push(sanitizeValue(item, config, warnings, seen, depth + 1));
        count++;
      }
      return arr;
    }

    // Handle plain objects
    return sanitizeObject(value as Record<string, unknown>, config, warnings, seen, depth);
  }

  // Unknown type - return safe string representation
  return String(value);
}

/**
 * Sanitize a string value.
 */
function sanitizeString(value: string, config: OutputSanitizerConfig, warnings: string[]): string {
  let result = value;

  // Remove file paths if configured
  if (config.removeFilePaths) {
    const pathRegex = /(?:\/[\w.-]+)+|(?:[A-Za-z]:\\[\w\\.-]+)+/g;
    if (pathRegex.test(result)) {
      result = result.replace(pathRegex, '[path]');
      warnings.push('File paths removed from string');
    }
  }

  // Truncate if too long
  if (result.length > config.maxStringLength) {
    result = result.substring(0, config.maxStringLength) + '...[truncated]';
    warnings.push(`String truncated: exceeded ${config.maxStringLength} characters`);
  }

  return result;
}

/**
 * Sanitize an array.
 */
function sanitizeArray(
  value: unknown[],
  config: OutputSanitizerConfig,
  warnings: string[],
  seen: WeakSet<object>,
  depth: number,
): unknown[] {
  const result: unknown[] = [];
  const limit = Math.min(value.length, config.maxArrayLength);

  for (let i = 0; i < limit; i++) {
    result.push(sanitizeValue(value[i], config, warnings, seen, depth + 1));
  }

  if (value.length > config.maxArrayLength) {
    warnings.push(`Array truncated: ${value.length} items reduced to ${config.maxArrayLength}`);
  }

  return result;
}

/**
 * Sanitize a plain object.
 */
function sanitizeObject(
  value: Record<string, unknown>,
  config: OutputSanitizerConfig,
  warnings: string[],
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = Object.keys(value);
  const limit = Math.min(keys.length, config.maxObjectKeys);

  for (let i = 0; i < limit; i++) {
    const key = keys[i];

    // Skip prototype pollution vectors
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      warnings.push(`Dangerous key "${key}" removed`);
      continue;
    }

    result[key] = sanitizeValue(value[key], config, warnings, seen, depth + 1);
  }

  if (keys.length > config.maxObjectKeys) {
    warnings.push(`Object truncated: ${keys.length} keys reduced to ${config.maxObjectKeys}`);
  }

  return result;
}

/**
 * Sanitize an Error object.
 */
function sanitizeError(error: Error, config: OutputSanitizerConfig, warnings: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: sanitizeString(error.message, config, warnings),
  };

  // Include stack only if configured
  if (!config.removeStackTraces && error.stack) {
    result['stack'] = sanitizeString(error.stack, config, warnings);
  } else if (error.stack) {
    warnings.push('Stack trace removed');
  }

  // Include error code if present
  if ('code' in error) {
    result['code'] = (error as any).code;
  }

  return result;
}

/**
 * Quick check if a value needs sanitization.
 * Used for optimization - skip sanitization for simple values.
 */
export function needsSanitization(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return false;
  }

  if (typeof value === 'string') {
    // Quick heuristic: check if string might contain paths
    return value.length > 100 || value.includes('/') || value.includes('\\');
  }

  // Objects and arrays always need checking
  return true;
}

/**
 * Sanitize a log message (less aggressive than output sanitization).
 */
export function sanitizeLogMessage(message: string, maxLength = 500): string {
  if (!message) return '';

  let result = message;

  // Remove file paths
  result = result.replace(/(?:\/[\w.-]+)+|(?:[A-Za-z]:\\[\w\\.-]+)+/g, '[path]');

  // Remove line numbers
  result = result.replace(/:\d+:\d+/g, '');

  // Remove stack trace lines
  result = result.replace(/\n\s*at .*/g, '');

  // Truncate
  if (result.length > maxLength) {
    result = result.substring(0, maxLength) + '...';
  }

  return result.trim();
}
