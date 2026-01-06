/**
 * Safe regex utilities using ast-guard's ReDoS analysis.
 *
 * These utilities protect against ReDoS (Regular Expression Denial of Service)
 * attacks by validating patterns and enforcing input length limits.
 */

import { analyzeForReDoS, REDOS_THRESHOLDS } from 'ast-guard';

/**
 * Default maximum input length for safe regex operations.
 * Inputs longer than this will be rejected to prevent ReDoS attacks.
 */
export const DEFAULT_MAX_INPUT_LENGTH = 50000;

/**
 * Configuration options for safe regex operations.
 */
export interface SafeRegexOptions {
  /**
   * Maximum input length to process.
   * If input exceeds this, operations return null/fallback.
   * @default 50000
   */
  maxInputLength?: number;

  /**
   * Analysis level for pattern vulnerability detection.
   * - 'catastrophic': Only detect exponential-time vulnerabilities (faster)
   * - 'polynomial': Also detect polynomial-time vulnerabilities (more thorough)
   * @default 'polynomial'
   */
  level?: 'catastrophic' | 'polynomial';

  /**
   * If true, throw an error when pattern is vulnerable instead of returning null.
   * @default false
   */
  throwOnVulnerable?: boolean;
}

/**
 * Result from pattern analysis.
 */
export interface PatternAnalysisResult {
  /** Whether the pattern is safe to use */
  safe: boolean;
  /** Vulnerability score (0-100, higher = more vulnerable) */
  score: number;
  /** Type of vulnerability detected, if any */
  vulnerabilityType?: string;
  /** Human-readable explanation of the vulnerability */
  explanation?: string;
}

/**
 * Analyze a regex pattern for ReDoS vulnerability.
 *
 * Uses ast-guard's analyzeForReDoS to detect patterns that could cause
 * exponential or polynomial backtracking on malicious input.
 *
 * @param pattern - Regex pattern to analyze (string or RegExp)
 * @param level - Analysis level: 'catastrophic' or 'polynomial'
 * @returns Analysis result with safety assessment
 *
 * @example
 * ```typescript
 * const result = analyzePattern('(a+)+');
 * // result.safe === false (nested quantifiers)
 *
 * const result2 = analyzePattern('[a-z]+');
 * // result2.safe === true
 * ```
 */
export function analyzePattern(
  pattern: string | RegExp,
  level: 'catastrophic' | 'polynomial' = 'polynomial',
): PatternAnalysisResult {
  const patternStr = typeof pattern === 'string' ? pattern : pattern.source;

  // First, check if the pattern is syntactically valid
  try {
    new RegExp(patternStr);
  } catch {
    return {
      safe: false,
      score: 100,
      vulnerabilityType: 'invalid_syntax',
      explanation: 'Pattern has invalid regex syntax',
    };
  }

  try {
    const result = analyzeForReDoS(patternStr, level);

    return {
      safe: !result.vulnerable,
      score: result.score,
      vulnerabilityType: result.vulnerabilityType,
      explanation: result.explanation,
    };
  } catch {
    // If analysis fails, treat pattern as potentially unsafe
    return {
      safe: false,
      score: 100,
      vulnerabilityType: 'analysis_failed',
      explanation: 'Pattern analysis failed - treating as potentially unsafe',
    };
  }
}

/**
 * Check if a regex pattern is safe from ReDoS vulnerabilities.
 *
 * @param pattern - Regex pattern to check (string or RegExp)
 * @param level - Analysis level: 'catastrophic' or 'polynomial'
 * @returns true if pattern is safe, false if vulnerable
 *
 * @example
 * ```typescript
 * isPatternSafe('(a+)+'); // false - nested quantifiers
 * isPatternSafe('[a-z]+'); // true
 * isPatternSafe(/^foo$/); // true
 * ```
 */
export function isPatternSafe(pattern: string | RegExp, level: 'catastrophic' | 'polynomial' = 'polynomial'): boolean {
  return analyzePattern(pattern, level).safe;
}

/**
 * Create a validated RegExp that has been checked for ReDoS vulnerabilities.
 *
 * @param pattern - Pattern string
 * @param flags - Optional regex flags
 * @param options - Safety options
 * @returns RegExp if pattern is safe, null if vulnerable or invalid
 *
 * @example
 * ```typescript
 * const regex = createSafeRegExp('[a-z]+', 'g');
 * if (regex) {
 *   // Pattern is safe to use
 * }
 * ```
 */
export function createSafeRegExp(pattern: string, flags?: string, options: SafeRegexOptions = {}): RegExp | null {
  const { level = 'polynomial', throwOnVulnerable = false } = options;

  const analysis = analyzePattern(pattern, level);

  if (!analysis.safe) {
    if (throwOnVulnerable) {
      throw new Error(`Vulnerable regex pattern detected: ${analysis.explanation || analysis.vulnerabilityType}`);
    }
    return null;
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Execute regex test() with input length protection.
 *
 * Returns null if input exceeds maxInputLength to prevent ReDoS attacks.
 *
 * @param pattern - RegExp to test with
 * @param input - String to test
 * @param options - Safety options including maxInputLength
 * @returns Match result, or null if input is too long
 *
 * @example
 * ```typescript
 * const result = safeTest(/foo/, userInput, { maxInputLength: 10000 });
 * if (result === null) {
 *   // Input was too long, rejected for safety
 * } else if (result) {
 *   // Pattern matched
 * }
 * ```
 */
export function safeTest(pattern: RegExp, input: string, options: SafeRegexOptions = {}): boolean | null {
  const { maxInputLength = DEFAULT_MAX_INPUT_LENGTH } = options;

  if (input.length > maxInputLength) {
    return null;
  }

  return pattern.test(input);
}

/**
 * Execute regex match() with input length protection.
 *
 * Returns null if input exceeds maxInputLength to prevent ReDoS attacks.
 *
 * @param pattern - RegExp to match with
 * @param input - String to match against
 * @param options - Safety options including maxInputLength
 * @returns Match result array, or null if input is too long or no match
 *
 * @example
 * ```typescript
 * const matches = safeMatch(/(\d+)/, userInput, { maxInputLength: 5000 });
 * ```
 */
export function safeMatch(pattern: RegExp, input: string, options: SafeRegexOptions = {}): RegExpMatchArray | null {
  const { maxInputLength = DEFAULT_MAX_INPUT_LENGTH } = options;

  if (input.length > maxInputLength) {
    return null;
  }

  return input.match(pattern);
}

/**
 * Execute regex replace() with input length protection.
 *
 * Returns original input unchanged if it exceeds maxInputLength to prevent ReDoS attacks.
 *
 * @param input - String to perform replacement on
 * @param pattern - RegExp pattern to match
 * @param replacement - Replacement string or function
 * @param options - Safety options including maxInputLength
 * @returns Replaced string, or original input if too long
 *
 * @example
 * ```typescript
 * const result = safeReplace(userInput, /foo/g, 'bar', { maxInputLength: 10000 });
 * ```
 */
export function safeReplace(
  input: string,
  pattern: RegExp,
  replacement: string | ((match: string, ...args: unknown[]) => string),
  options: SafeRegexOptions = {},
): string {
  const { maxInputLength = DEFAULT_MAX_INPUT_LENGTH } = options;

  if (input.length > maxInputLength) {
    return input;
  }

  return input.replace(pattern, replacement as string);
}

/**
 * Execute regex exec() with input length protection.
 *
 * Returns null if input exceeds maxInputLength to prevent ReDoS attacks.
 *
 * @param pattern - RegExp to execute
 * @param input - String to execute against
 * @param options - Safety options including maxInputLength
 * @returns Exec result array, or null if input is too long or no match
 *
 * @example
 * ```typescript
 * const result = safeExec(/(\w+)/, userInput, { maxInputLength: 10000 });
 * ```
 */
export function safeExec(pattern: RegExp, input: string, options: SafeRegexOptions = {}): RegExpExecArray | null {
  const { maxInputLength = DEFAULT_MAX_INPUT_LENGTH } = options;

  if (input.length > maxInputLength) {
    return null;
  }

  return pattern.exec(input);
}

/**
 * Check if input length is within safe limits for regex operations.
 *
 * @param input - String to check
 * @param maxLength - Maximum allowed length
 * @returns true if input is within limits
 */
export function isInputLengthSafe(input: string, maxLength: number = DEFAULT_MAX_INPUT_LENGTH): boolean {
  return input.length <= maxLength;
}

// Re-export REDOS_THRESHOLDS from ast-guard for convenience
export { REDOS_THRESHOLDS };
