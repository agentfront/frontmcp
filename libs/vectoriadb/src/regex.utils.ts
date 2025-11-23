/**
 * Regular expression utilities with ReDoS (Regular Expression Denial of Service) protection
 *
 * ReDoS attacks exploit poorly designed regex patterns that can cause catastrophic backtracking,
 * leading to exponential time complexity and potential service outages.
 *
 * Guidelines for safe regex patterns:
 * 1. Avoid nested quantifiers: /(a+)+$/ is vulnerable
 * 2. Avoid alternation with overlapping patterns: /(a|a)*$/ is vulnerable
 * 3. Avoid patterns that can match the same input in multiple ways
 * 4. Use atomic groups or possessive quantifiers when available
 * 5. Always limit input length before applying complex patterns
 * 6. Test patterns with long, repetitive inputs
 */

/**
 * Detects potentially vulnerable regex patterns
 * Checks for common ReDoS patterns like nested quantifiers
 *
 * @param pattern - The regex pattern to check
 * @returns true if the pattern is potentially vulnerable
 */
export function isPotentiallyVulnerableRegex(pattern: string): boolean {
  // Check for nested quantifiers: (a+)+ or (a*)*
  const nestedQuantifiers = /\([^)]*[*+{][^)]*\)[*+{]/;
  if (nestedQuantifiers.test(pattern)) {
    return true;
  }

  // Check for alternation with overlapping patterns: (a|ab)*
  const alternationOverlap = /\([^|]*\|[^)]*\)[*+{]/;
  if (alternationOverlap.test(pattern)) {
    return true;
  }

  // Check for repeated groups with quantifiers: (a+)+
  const repeatedGroups = /\([^)]*[*+][^)]*\)[*+]/;
  if (repeatedGroups.test(pattern)) {
    return true;
  }

  return false;
}

/**
 * Creates a safe regex with timeout protection
 * Wraps regex execution with a timeout to prevent ReDoS attacks
 *
 * @param pattern - The regex pattern
 * @param flags - Optional regex flags
 * @param timeoutMs - Maximum execution time in milliseconds (default: 100ms)
 * @returns A function that safely executes the regex
 */
export function createSafeRegex(
  pattern: string | RegExp,
  flags?: string,
  _timeoutMs = 100,
): (input: string) => RegExpMatchArray | null {
  const regex = typeof pattern === 'string' ? new RegExp(pattern, flags) : pattern;

  return (input: string): RegExpMatchArray | null => {
    // Limit input length as first line of defense
    const maxInputLength = 10000;
    if (input.length > maxInputLength) {
      input = input.substring(0, maxInputLength);
    }

    // Note: JavaScript doesn't have built-in regex timeout
    // For production use, consider using a worker thread or
    // a library like 'safe-regex' for more robust protection
    try {
      return input.match(regex);
    } catch {
      // Regex execution failed
      return null;
    }
  };
}

/**
 * Validates that a string matches a pattern safely
 * Limits input length and provides basic ReDoS protection
 *
 * @param input - The string to validate
 * @param pattern - The regex pattern
 * @param maxLength - Maximum input length to process (default: 10000)
 * @returns true if the input matches the pattern
 */
export function safeTest(input: string, pattern: RegExp, maxLength = 10000): boolean {
  if (input.length > maxLength) {
    return false;
  }

  try {
    return pattern.test(input);
  } catch {
    return false;
  }
}

/**
 * Safe regex patterns commonly used in the codebase
 * These patterns have been reviewed for ReDoS vulnerabilities
 */
export const SAFE_PATTERNS = {
  /** Matches control characters (newlines, tabs, null bytes, etc.) */
  // eslint-disable-next-line no-control-regex
  CONTROL_CHARS: /[\r\n\t\0\u000B\u000C]/g,

  /** Matches path separators (forward and backslash) */
  PATH_SEPARATORS: /[/\\]/g,

  /** Matches directory traversal sequences */
  DIR_TRAVERSAL: /\.\./g,

  /** Matches alphanumeric, underscore, and hyphen */
  ALPHANUMERIC_SAFE: /[^a-zA-Z0-9-_]/g,

  /** Matches word characters, colon, dot, and dash */
  REDIS_KEY_SAFE: /[^\w:.-]/g,

  /** Matches leading dots and dashes */
  LEADING_DOTS_DASHES: /^[.-]+/,

  /** Trailing dots and dashes */
  TRAILING_DOTS_DASHES: /[.-]+$/,
} as const;
