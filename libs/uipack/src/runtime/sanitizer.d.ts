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
export declare const REDACTION_TOKENS: {
  readonly EMAIL: '[EMAIL]';
  readonly PHONE: '[PHONE]';
  readonly CARD: '[CARD]';
  readonly ID: '[ID]';
  readonly IP: '[IP]';
  readonly REDACTED: '[REDACTED]';
};
/**
 * PII detection patterns
 */
export declare const PII_PATTERNS: {
  email: RegExp;
  emailInText: RegExp;
  phone: RegExp;
  phoneInText: RegExp;
  creditCard: RegExp;
  creditCardInText: RegExp;
  ssn: RegExp;
  ssnInText: RegExp;
  ipv4: RegExp;
  ipv4InText: RegExp;
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
export declare function isEmail(value: string): boolean;
/**
 * Check if a string matches a phone pattern
 */
export declare function isPhone(value: string): boolean;
/**
 * Check if a string matches a credit card pattern
 */
export declare function isCreditCard(value: string): boolean;
/**
 * Check if a string matches an SSN pattern
 */
export declare function isSSN(value: string): boolean;
/**
 * Check if a string matches an IPv4 pattern
 */
export declare function isIPv4(value: string): boolean;
/**
 * Detect PII type in a string value
 */
export declare function detectPIIType(value: string): keyof typeof REDACTION_TOKENS | null;
/**
 * Redact PII patterns from text
 */
export declare function redactPIIFromText(text: string): string;
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
export declare function sanitizeInput(
  input: Record<string, unknown>,
  mode?: true | string[] | SanitizerFn,
): Record<string, unknown>;
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
export declare function createSanitizer(
  mode?: true | string[] | SanitizerFn,
): (input: Record<string, unknown>) => Record<string, unknown>;
/**
 * Check if an object contains any detected PII.
 * Does not modify the input.
 *
 * @param input - The input to check
 * @param options - Optional configuration
 * @param options.maxDepth - Maximum recursion depth (default: 10)
 * @returns Object with boolean `hasPII` and `fields` array of field paths
 */
export declare function detectPII(
  input: Record<string, unknown>,
  options?: {
    maxDepth?: number;
  },
): {
  hasPII: boolean;
  fields: string[];
};
//# sourceMappingURL=sanitizer.d.ts.map
