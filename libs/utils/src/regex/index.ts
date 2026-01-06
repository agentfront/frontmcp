/**
 * Safe regex utilities for preventing ReDoS (Regular Expression Denial of Service) attacks.
 *
 * Uses ast-guard's analyzeForReDoS function to validate patterns and provides
 * input length guards to prevent polynomial-time attacks on untrusted data.
 *
 * @example
 * ```typescript
 * import { isPatternSafe, safeTest, safeReplace, trimBoth } from '@frontmcp/utils';
 *
 * // Check if a pattern is safe
 * if (isPatternSafe(myPattern)) {
 *   // Use pattern
 * }
 *
 * // Safe regex operations with input length guards
 * const result = safeTest(/foo/, userInput, { maxInputLength: 10000 });
 *
 * // Pre-built safe patterns for common operations
 * const trimmed = trimBoth(input, '/');
 * ```
 */

export * from './safe-regex';
export * from './patterns';
