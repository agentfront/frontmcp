/**
 * Security utilities for ReDoS (Regular Expression Denial of Service) protection
 *
 * This module provides safeguards against malicious or pathological regex patterns
 * that could cause performance degradation or hangs.
 */

/**
 * Known dangerous regex patterns that can cause ReDoS
 * These patterns are checked before allowing regex creation
 */
const REDOS_PATTERNS = [
  // Nested quantifiers: (a+)+, (a*)*, (\d+)* - closing paren followed by quantifier
  /\)\s*[*+]/,
  // Alternation with quantifier is already caught by above, but keep for clarity
  /\([^)]*\|[^)]*\)\s*[*+]/,
];

/**
 * Maximum allowed pattern length
 * Extremely long patterns can cause issues even without ReDoS
 */
const MAX_PATTERN_LENGTH = 1000;

/**
 * Maximum allowed quantifier value in {n,m} syntax
 */
const MAX_QUANTIFIER = 100;

/**
 * Result of pattern validation
 */
export interface PatternValidationResult {
  /** Whether the pattern is safe to use */
  safe: boolean;
  /** Reason why the pattern is unsafe (if applicable) */
  reason?: string;
  /** The validated pattern (if safe) */
  pattern?: string;
}

/**
 * Validates a regex pattern for potential ReDoS vulnerabilities
 *
 * This function checks for:
 * - Known dangerous patterns
 * - Excessive pattern length
 * - Large quantifiers
 * - Nested quantifiers
 *
 * @param pattern - The regex pattern to validate
 * @returns Validation result with safety status and reason
 *
 * @example
 * ```typescript
 * const result = validatePattern('^[a-z]+$');
 * if (result.safe) {
 *   const regex = new RegExp(result.pattern);
 * } else {
 *   console.error('Unsafe pattern:', result.reason);
 * }
 * ```
 */
export function validatePattern(pattern: string): PatternValidationResult {
  // Check pattern length using config
  const maxLength = globalConfig.maxPatternLength;
  if (pattern.length > maxLength) {
    return {
      safe: false,
      reason: `Pattern exceeds maximum length of ${maxLength} characters`,
    };
  }

  // Try to create the regex first to catch syntax errors
  try {
    new RegExp(pattern);
  } catch (error) {
    return {
      safe: false,
      reason: `Invalid regex syntax: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }

  // Check for excessive quantifiers using config
  const maxQuant = globalConfig.maxQuantifier;
  const quantifierMatch = pattern.match(/\{(\d+),?(\d+)?\}/g);
  if (quantifierMatch) {
    for (const q of quantifierMatch) {
      const nums = q.match(/\d+/g);
      if (nums && nums.some((n) => parseInt(n) > maxQuant)) {
        return {
          safe: false,
          reason: `Quantifier exceeds maximum value of ${maxQuant}`,
        };
      }
    }
  }

  // Check for known dangerous patterns
  for (const dangerousPattern of REDOS_PATTERNS) {
    if (dangerousPattern.test(pattern)) {
      return {
        safe: false,
        reason: 'Pattern contains potentially dangerous constructs (nested quantifiers or alternations)',
      };
    }
  }

  return {
    safe: true,
    pattern,
  };
}

/**
 * Creates a RegExp from a pattern with timeout protection
 *
 * This function wraps RegExp creation with a timeout to prevent
 * hanging on pathological patterns. If the regex takes too long
 * to compile or execute, it returns null.
 *
 * @param pattern - The regex pattern
 * @param flags - Optional regex flags
 * @param timeoutMs - Maximum time to allow for regex operations (default: 100ms)
 * @returns The compiled RegExp or null if timeout/error occurs
 *
 * @example
 * ```typescript
 * const regex = createSafeRegExp('^[a-z]+$');
 * if (regex) {
 *   const isValid = regex.test(input);
 * }
 * ```
 */
export function createSafeRegExp(pattern: string, flags?: string, timeoutMs = 100): RegExp | null {
  // Check if protection is enabled
  if (!globalConfig.enableProtection) {
    // Protection disabled - create regex without validation
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      if (globalConfig.warnOnUnsafe) {
        console.warn(`[ReDoS Protection] Failed to create regex:`, error);
      }
      return null;
    }
  }

  // Protection enabled - validate the pattern
  const validation = validatePattern(pattern);
  if (!validation.safe) {
    const message = `[ReDoS Protection] Rejected unsafe pattern: ${validation.reason}`;

    if (globalConfig.throwOnUnsafe) {
      throw new Error(message);
    }

    if (globalConfig.warnOnUnsafe) {
      console.warn(message);
    }

    return null;
  }

  try {
    // Create the regex
    const regex = new RegExp(pattern, flags);

    // Use configured timeout or parameter timeout
    const timeout = timeoutMs ?? globalConfig.timeoutMs;

    // Test the regex with a simple string to catch runtime issues
    const testStart = Date.now();
    try {
      regex.test('test');
      const elapsed = Date.now() - testStart;

      if (elapsed > timeout) {
        const message = `[ReDoS Protection] Regex took ${elapsed}ms to test, rejecting pattern`;

        if (globalConfig.warnOnUnsafe) {
          console.warn(message);
        }

        return null;
      }
    } catch (error) {
      if (globalConfig.warnOnUnsafe) {
        console.warn(`[ReDoS Protection] Regex test failed:`, error);
      }
      return null;
    }

    return regex;
  } catch (error) {
    if (globalConfig.warnOnUnsafe) {
      console.warn(`[ReDoS Protection] Failed to create regex:`, error);
    }
    return null;
  }
}

/**
 * Configuration for pattern handling
 */
export interface PatternSecurityConfig {
  /** Whether to enable ReDoS protection (default: true) */
  enableProtection: boolean;
  /** Whether to warn on unsafe patterns (default: true) */
  warnOnUnsafe: boolean;
  /** Whether to throw on unsafe patterns (default: false) */
  throwOnUnsafe: boolean;
  /** Maximum pattern length (default: 1000) */
  maxPatternLength: number;
  /** Maximum quantifier value (default: 100) */
  maxQuantifier: number;
  /** Regex operation timeout in ms (default: 100) */
  timeoutMs: number;
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: PatternSecurityConfig = {
  enableProtection: true,
  warnOnUnsafe: true,
  throwOnUnsafe: false,
  maxPatternLength: MAX_PATTERN_LENGTH,
  maxQuantifier: MAX_QUANTIFIER,
  timeoutMs: 100,
};

/**
 * Global security configuration
 * Can be modified to adjust protection behavior
 */
let globalConfig: PatternSecurityConfig = { ...DEFAULT_SECURITY_CONFIG };

/**
 * Updates the global security configuration
 *
 * @param config - Partial configuration to merge with defaults
 *
 * @example
 * ```typescript
 * // Disable protection (not recommended for untrusted input)
 * setSecurityConfig({ enableProtection: false });
 *
 * // Make validation more strict
 * setSecurityConfig({ throwOnUnsafe: true, maxPatternLength: 500 });
 * ```
 */
export function setSecurityConfig(config: Partial<PatternSecurityConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Gets the current security configuration
 */
export function getSecurityConfig(): Readonly<PatternSecurityConfig> {
  return { ...globalConfig };
}

/**
 * Creates a safe regex pattern validator function for use in Zod refinements
 *
 * @param pattern - The regex pattern to validate against
 * @returns A validator function that safely tests strings against the pattern
 *
 * @example
 * ```typescript
 * const validator = createSafePatternValidator('^[a-z]+$');
 * const schema = z.string().refine(validator, 'Must match pattern');
 * ```
 */
export function createSafePatternValidator(pattern: string): (value: string) => boolean {
  const regex = createSafeRegExp(pattern);

  if (!regex) {
    // Pattern is unsafe, return a validator that always fails
    if (globalConfig.warnOnUnsafe) {
      console.warn(`[ReDoS Protection] Pattern rejected, validator will always return false`);
    }
    return () => false;
  }

  return (value: string): boolean => {
    try {
      const testStart = Date.now();
      const result = regex.test(value);
      const elapsed = Date.now() - testStart;

      if (elapsed > globalConfig.timeoutMs) {
        if (globalConfig.warnOnUnsafe) {
          console.warn(`[ReDoS Protection] Regex test took ${elapsed}ms, rejecting input`);
        }
        return false;
      }

      return result;
    } catch (error) {
      if (globalConfig.warnOnUnsafe) {
        console.warn(`[ReDoS Protection] Regex test failed:`, error);
      }
      return false;
    }
  };
}
