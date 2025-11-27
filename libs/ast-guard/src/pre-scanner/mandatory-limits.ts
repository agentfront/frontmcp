/**
 * Mandatory security limits that CANNOT be disabled or exceeded.
 * These provide defense-in-depth protection against DoS attacks
 * that could occur BEFORE AST parsing completes.
 *
 * @module pre-scanner/mandatory-limits
 */

/**
 * Absolute maximum limits that cannot be exceeded regardless of configuration.
 * These values are chosen to prevent memory exhaustion and stack overflow
 * attacks against the parser itself (acorn).
 */
export const MANDATORY_LIMITS = {
  /**
   * Maximum input size in bytes (100MB).
   * Prevents memory exhaustion during parsing.
   * Even with 64GB RAM, allowing unlimited input could cause issues.
   */
  ABSOLUTE_MAX_INPUT_SIZE: 100 * 1024 * 1024,

  /**
   * Maximum nesting depth for brackets/braces (200 levels).
   * Prevents stack overflow in recursive descent parsers.
   * Normal code rarely exceeds 20-30 levels.
   */
  ABSOLUTE_MAX_NESTING: 200,

  /**
   * Maximum single line length (100,000 characters).
   * Prevents memory issues with minified/obfuscated code.
   * Normal code lines rarely exceed 120 characters.
   */
  ABSOLUTE_MAX_LINE_LENGTH: 100_000,

  /**
   * Maximum number of lines (1,000,000 lines).
   * Prevents DoS via extremely long files.
   * Largest reasonable codebases rarely exceed 100k lines per file.
   */
  ABSOLUTE_MAX_LINES: 1_000_000,

  /**
   * Maximum string literal length (5MB).
   * Prevents memory exhaustion via huge embedded strings.
   */
  ABSOLUTE_MAX_STRING: 5 * 1024 * 1024,

  /**
   * Maximum regex literal length (1000 characters).
   * Prevents ReDoS via complex regex patterns.
   * Most legitimate regex patterns are under 200 characters.
   */
  ABSOLUTE_MAX_REGEX_LENGTH: 1000,

  /**
   * Maximum total string content in bytes (50MB).
   * Prevents memory exhaustion via many smaller strings.
   */
  ABSOLUTE_MAX_TOTAL_STRING_CONTENT: 50 * 1024 * 1024,

  /**
   * Maximum number of regex literals per file (50).
   * Prevents ReDoS multiplication attacks.
   * Normal code rarely has more than 10-20 regex patterns.
   */
  ABSOLUTE_MAX_REGEX_COUNT: 50,
} as const;

/**
 * Type for mandatory limit keys
 */
export type MandatoryLimitKey = keyof typeof MANDATORY_LIMITS;

/**
 * Checks if a value exceeds a mandatory limit.
 * This function is used internally by the pre-scanner.
 *
 * @param limitKey - The limit to check against
 * @param value - The actual value to check
 * @returns true if the value exceeds the limit
 */
export function exceedsMandatoryLimit(limitKey: MandatoryLimitKey, value: number): boolean {
  return value > MANDATORY_LIMITS[limitKey];
}

/**
 * Returns the effective limit, clamped to mandatory maximum.
 * Used when user provides a custom limit that might exceed mandatory caps.
 *
 * @param limitKey - The mandatory limit to clamp to
 * @param userLimit - The user-provided limit
 * @returns The effective limit (minimum of user limit and mandatory cap)
 */
export function clampToMandatoryLimit(limitKey: MandatoryLimitKey, userLimit: number): number {
  return Math.min(userLimit, MANDATORY_LIMITS[limitKey]);
}

/**
 * Validates that all user-provided limits respect mandatory caps.
 * Throws ConfigurationError if any limit exceeds mandatory maximum.
 *
 * @param limits - Object mapping limit keys to user values
 * @throws ConfigurationError if any limit exceeds mandatory maximum
 */
export function validateLimitsAgainstMandatory(limits: Partial<Record<MandatoryLimitKey, number>>): void {
  for (const [key, value] of Object.entries(limits)) {
    const limitKey = key as MandatoryLimitKey;
    if (limitKey in MANDATORY_LIMITS && value !== undefined) {
      if (value > MANDATORY_LIMITS[limitKey]) {
        throw new Error(
          `Configuration error: ${limitKey} (${value}) exceeds mandatory maximum (${MANDATORY_LIMITS[limitKey]}). ` +
            `This limit cannot be exceeded for security reasons.`,
        );
      }
    }
  }
}
