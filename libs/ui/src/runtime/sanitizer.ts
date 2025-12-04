/**
 * Input Sanitizer
 *
 * Provides PII detection and redaction for tool inputs before they are
 * exposed to widget code. This protects sensitive data from being
 * accidentally exposed in client-side widgets.
 *
 * Built-in patterns:
 * - Email addresses → [EMAIL]
 * - Phone numbers → [PHONE]
 * - Credit card numbers → [CARD]
 * - SSN / National IDs → [ID]
 * - IP addresses → [IP]
 *
 * @example
 * ```typescript
 * import { sanitizeInput, createSanitizer } from './sanitizer';
 *
 * // Auto-detect and redact PII
 * const sanitized = sanitizeInput({
 *   user: 'john@example.com',
 *   phone: '555-123-4567',
 *   message: 'Hello world',
 * });
 * // Result: { user: '[EMAIL]', phone: '[PHONE]', message: 'Hello world' }
 *
 * // Redact specific fields
 * const sanitized2 = sanitizeInput(data, ['email', 'ssn']);
 *
 * // Custom sanitizer
 * const sanitized3 = sanitizeInput(data, (key, value) => {
 *   if (key === 'secret') return '[REDACTED]';
 *   return value;
 * });
 * ```
 */

/**
 * Redaction placeholder tokens
 */
export const REDACTION_TOKENS = {
  EMAIL: '[EMAIL]',
  PHONE: '[PHONE]',
  CARD: '[CARD]',
  ID: '[ID]',
  IP: '[IP]',
  REDACTED: '[REDACTED]',
} as const;

/**
 * PII detection patterns
 */
export const PII_PATTERNS = {
  // Email: user@domain.tld
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,

  // Email embedded in text
  emailInText: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Phone: Various formats (US-centric but flexible)
  phone: /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,4}[-\s.]?[0-9]{1,9}$/,

  // Phone embedded in text
  phoneInText: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g,

  // Credit card: 13-19 digits (with optional separators)
  creditCard: /^(?:[0-9]{4}[-\s]?){3,4}[0-9]{1,4}$/,

  // Credit card embedded in text
  creditCardInText: /\b(?:[0-9]{4}[-\s]?){3,4}[0-9]{1,4}\b/g,

  // SSN: XXX-XX-XXXX
  ssn: /^[0-9]{3}[-]?[0-9]{2}[-]?[0-9]{4}$/,

  // SSN embedded in text
  ssnInText: /\b[0-9]{3}[-]?[0-9]{2}[-]?[0-9]{4}\b/g,

  // IPv4 address
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,

  // IPv4 embedded in text
  ipv4InText: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
};

/**
 * Custom sanitizer function type
 */
export type SanitizerFn = (key: string, value: unknown, path: string[]) => unknown;

/**
 * Sanitizer options
 */
export interface SanitizeOptions {
  /**
   * How to handle PII detection:
   * - true: Auto-detect and redact common PII patterns
   * - string[]: Only redact values in fields with these names
   * - SanitizerFn: Custom sanitizer function
   */
  mode: true | string[] | SanitizerFn;

  /**
   * Maximum depth for recursive sanitization
   * @default 10
   */
  maxDepth?: number;

  /**
   * Whether to sanitize PII patterns within string values
   * @default true
   */
  sanitizeInText?: boolean;
}

/**
 * Check if a string matches an email pattern
 */
export function isEmail(value: string): boolean {
  return PII_PATTERNS.email.test(value);
}

/**
 * Check if a string matches a phone pattern
 */
export function isPhone(value: string): boolean {
  return PII_PATTERNS.phone.test(value);
}

/**
 * Check if a string matches a credit card pattern
 */
export function isCreditCard(value: string): boolean {
  // Remove separators for digit count check
  const digits = value.replace(/[-\s]/g, '');
  return digits.length >= 13 && digits.length <= 19 && PII_PATTERNS.creditCard.test(value);
}

/**
 * Check if a string matches an SSN pattern
 */
export function isSSN(value: string): boolean {
  return PII_PATTERNS.ssn.test(value);
}

/**
 * Check if a string matches an IPv4 pattern
 */
export function isIPv4(value: string): boolean {
  return PII_PATTERNS.ipv4.test(value);
}

/**
 * Detect PII type in a string value
 */
export function detectPIIType(value: string): keyof typeof REDACTION_TOKENS | null {
  if (isEmail(value)) return 'EMAIL';
  if (isCreditCard(value)) return 'CARD';
  if (isSSN(value)) return 'ID';
  if (isPhone(value)) return 'PHONE';
  if (isIPv4(value)) return 'IP';
  return null;
}

/**
 * Redact PII patterns from text
 */
export function redactPIIFromText(text: string): string {
  let result = text;

  // Order matters - more specific patterns first
  result = result.replace(PII_PATTERNS.creditCardInText, REDACTION_TOKENS.CARD);
  result = result.replace(PII_PATTERNS.ssnInText, REDACTION_TOKENS.ID);
  result = result.replace(PII_PATTERNS.emailInText, REDACTION_TOKENS.EMAIL);
  result = result.replace(PII_PATTERNS.phoneInText, REDACTION_TOKENS.PHONE);
  result = result.replace(PII_PATTERNS.ipv4InText, REDACTION_TOKENS.IP);

  return result;
}

/**
 * Sanitize a value based on its type
 */
function sanitizeValue(
  key: string,
  value: unknown,
  path: string[],
  options: SanitizeOptions,
  depth: number,
  visited: WeakSet<object>,
): unknown {
  const maxDepth = options.maxDepth ?? 10;

  // Prevent infinite recursion
  if (depth > maxDepth) {
    return value;
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle custom sanitizer function
  if (typeof options.mode === 'function') {
    return options.mode(key, value, path);
  }

  // Handle field name list
  if (Array.isArray(options.mode)) {
    const lowerKey = key.toLowerCase();
    if (options.mode.some((f) => f.toLowerCase() === lowerKey)) {
      return REDACTION_TOKENS.REDACTED;
    }
    // Continue to recurse into objects/arrays
  }

  // Handle string values
  if (typeof value === 'string') {
    // Auto-detect mode: check if entire string is PII
    if (options.mode === true) {
      const piiType = detectPIIType(value);
      if (piiType) {
        return REDACTION_TOKENS[piiType];
      }

      // Check for PII patterns embedded in text
      if (options.sanitizeInText !== false) {
        const redacted = redactPIIFromText(value);
        if (redacted !== value) {
          return redacted;
        }
      }
    }

    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    // Check for circular reference
    if (visited.has(value)) {
      return REDACTION_TOKENS.REDACTED;
    }
    visited.add(value);
    return value.map((item, index) =>
      sanitizeValue(String(index), item, [...path, String(index)], options, depth + 1, visited),
    );
  }

  // Handle objects
  if (typeof value === 'object') {
    // Check for circular reference
    if (visited.has(value)) {
      return REDACTION_TOKENS.REDACTED;
    }
    visited.add(value);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = sanitizeValue(k, v, [...path, k], options, depth + 1, visited);
    }
    return result;
  }

  // Return primitives as-is
  return value;
}

/**
 * Sanitize input data by redacting PII.
 *
 * @param input - The input data to sanitize
 * @param mode - Sanitization mode:
 *   - `true`: Auto-detect and redact common PII patterns
 *   - `string[]`: Redact values in fields with these names
 *   - `SanitizerFn`: Custom sanitizer function
 * @returns Sanitized copy of the input
 *
 * @example
 * ```typescript
 * // Auto-detect PII
 * sanitizeInput({ email: 'test@example.com' });
 * // { email: '[EMAIL]' }
 *
 * // Redact specific fields
 * sanitizeInput({ password: 'secret', name: 'John' }, ['password']);
 * // { password: '[REDACTED]', name: 'John' }
 *
 * // Custom sanitizer
 * sanitizeInput(data, (key, value) => key === 'token' ? '[TOKEN]' : value);
 * ```
 */
export function sanitizeInput(
  input: Record<string, unknown>,
  mode: true | string[] | SanitizerFn = true,
): Record<string, unknown> {
  // Return empty object for invalid inputs to maintain type contract
  if (!input || typeof input !== 'object') {
    return {};
  }

  const options: SanitizeOptions = {
    mode,
    maxDepth: 10,
    sanitizeInText: true,
  };

  const visited = new WeakSet<object>();
  return sanitizeValue('', input, [], options, 0, visited) as Record<string, unknown>;
}

/**
 * Create a reusable sanitizer function with preset options.
 *
 * @param mode - Sanitization mode
 * @returns Sanitizer function
 *
 * @example
 * ```typescript
 * const sanitizer = createSanitizer(['email', 'phone', 'ssn']);
 *
 * const clean1 = sanitizer(userData1);
 * const clean2 = sanitizer(userData2);
 * ```
 */
export function createSanitizer(
  mode: true | string[] | SanitizerFn = true,
): (input: Record<string, unknown>) => Record<string, unknown> {
  return (input) => sanitizeInput(input, mode);
}

/**
 * Check if an object contains any detected PII.
 * Does not modify the input.
 *
 * @param input - The input to check
 * @param options - Optional configuration
 * @param options.maxDepth - Maximum recursion depth (default: 10)
 * @returns Object with boolean `hasPII` and `fields` array of field paths
 */
export function detectPII(
  input: Record<string, unknown>,
  options?: { maxDepth?: number },
): {
  hasPII: boolean;
  fields: string[];
} {
  const maxDepth = options?.maxDepth ?? 10;
  const fields: string[] = [];
  const visited = new WeakSet<object>();

  const check = (value: unknown, path: string[], depth: number): void => {
    // Prevent stack overflow on deeply nested structures
    if (depth > maxDepth) return;

    if (value === null || value === undefined) return;

    if (typeof value === 'string') {
      if (detectPIIType(value)) {
        fields.push(path.join('.'));
      }
      return;
    }

    if (Array.isArray(value)) {
      // Check for circular reference
      if (visited.has(value)) return;
      visited.add(value);
      value.forEach((item, index) => check(item, [...path, String(index)], depth + 1));
      return;
    }

    if (typeof value === 'object') {
      // Check for circular reference
      if (visited.has(value)) return;
      visited.add(value);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        check(v, [...path, k], depth + 1);
      }
    }
  };

  check(input, [], 0);

  return {
    hasPII: fields.length > 0,
    fields,
  };
}
