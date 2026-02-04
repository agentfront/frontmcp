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

import DOMPurify from 'dompurify';

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
 * Maximum text length for PII redaction (ReDoS prevention).
 * Text longer than this will be returned unchanged.
 */
const MAX_PII_TEXT_LENGTH = 100000;

/**
 * Redact PII patterns from text
 */
export function redactPIIFromText(text: string): string {
  // Guard against ReDoS on large inputs
  if (text.length > MAX_PII_TEXT_LENGTH) {
    return text;
  }

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

// ============================================
// HTML Sanitization
// ============================================

/**
 * Event handler attributes to remove.
 */
const HTML_EVENT_HANDLERS = new Set([
  'onabort',
  'onafterprint',
  'onauxclick',
  'onbeforematch',
  'onbeforeprint',
  'onbeforetoggle',
  'onbeforeunload',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextlost',
  'oncontextmenu',
  'oncontextrestored',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onemptied',
  'onended',
  'onerror',
  'onfocus',
  'onformdata',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onlanguagechange',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onmessage',
  'onmessageerror',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onoffline',
  'ononline',
  'onpagehide',
  'onpageshow',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onrejectionhandled',
  'onreset',
  'onresize',
  'onscroll',
  'onscrollend',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onslotchange',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'onunhandledrejection',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwheel',
]);

/**
 * Tags to remove completely (including content).
 */
const HTML_DANGEROUS_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'applet', 'base']);

/**
 * Dangerous URL schemes.
 */
const HTML_DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:'];

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses DOMPurify for robust sanitization when available (browser), falls back to parser-based approach.
 *
 * @param html - HTML string to sanitize
 * @returns Sanitized HTML string
 */
export function sanitizeHtmlContent(html: string): string {
  // In browser environment with DOM available, use DOMPurify for robust sanitization
  // DOMPurify handles edge cases like SVG, MathML, namespaced elements, browser-specific
  // parsing quirks, and mutation XSS attacks
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return DOMPurify.sanitize(html);
  }

  // Fallback: Use character-by-character parsing in non-DOM environments
  return sanitizeHtmlViaParser(html);
}

/**
 * Character-by-character HTML sanitization (for non-browser environments).
 */
function sanitizeHtmlViaParser(html: string): string {
  const result: string[] = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] === '<') {
      const tagEnd = findTagEnd(html, i);
      if (tagEnd === -1) {
        result.push(html[i]);
        i++;
        continue;
      }

      const tagContent = html.slice(i + 1, tagEnd);
      const tagInfo = parseTagContent(tagContent);

      if (!tagInfo) {
        result.push(html[i]);
        i++;
        continue;
      }

      const { tagName, isClosing, isSelfClosing, attributes } = tagInfo;
      const tagLower = tagName.toLowerCase();

      // Skip dangerous tags
      if (HTML_DANGEROUS_TAGS.has(tagLower)) {
        if (!isClosing && !isSelfClosing) {
          // Skip to closing tag
          const closeTag = `</${tagLower}`;
          const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
          if (closeIdx !== -1) {
            const closeEnd = html.indexOf('>', closeIdx);
            i = closeEnd !== -1 ? closeEnd + 1 : tagEnd + 1;
          } else {
            i = tagEnd + 1;
          }
        } else {
          i = tagEnd + 1;
        }
        continue;
      }

      // Build sanitized tag
      const safeAttrs = sanitizeAttributes(attributes);
      if (isClosing) {
        result.push(`</${tagName}>`);
      } else if (isSelfClosing) {
        result.push(`<${tagName}${safeAttrs} />`);
      } else {
        result.push(`<${tagName}${safeAttrs}>`);
      }
      i = tagEnd + 1;
    } else {
      result.push(html[i]);
      i++;
    }
  }

  return result.join('');
}

/**
 * Find the closing '>' of a tag.
 */
function findTagEnd(html: string, start: number): number {
  let i = start + 1;
  let inQuote: string | null = null;

  while (i < html.length) {
    if (inQuote) {
      if (html[i] === inQuote) inQuote = null;
    } else {
      if (html[i] === '"' || html[i] === "'") {
        inQuote = html[i];
      } else if (html[i] === '>') {
        return i;
      }
    }
    i++;
  }

  return -1;
}

/**
 * Parse tag content to extract name and attributes.
 */
function parseTagContent(content: string): {
  tagName: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  attributes: Array<{ name: string; value: string }>;
} | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  let idx = 0;
  const isClosing = trimmed[0] === '/';
  if (isClosing) idx++;

  // Skip whitespace
  while (idx < trimmed.length && /\s/.test(trimmed[idx])) idx++;

  // Parse tag name
  const nameStart = idx;
  while (idx < trimmed.length && /[a-zA-Z0-9]/.test(trimmed[idx])) idx++;
  const tagName = trimmed.slice(nameStart, idx);

  if (!tagName) return null;

  // Check for self-closing
  const isSelfClosing = trimmed.endsWith('/');

  // Parse attributes
  const attributes: Array<{ name: string; value: string }> = [];
  const attrPart = isSelfClosing ? trimmed.slice(idx, -1) : trimmed.slice(idx);

  let attrIdx = 0;
  while (attrIdx < attrPart.length) {
    // Skip whitespace
    while (attrIdx < attrPart.length && /\s/.test(attrPart[attrIdx])) attrIdx++;
    if (attrIdx >= attrPart.length) break;

    // Parse attribute name
    const attrNameStart = attrIdx;
    while (attrIdx < attrPart.length && /[a-zA-Z0-9_-]/.test(attrPart[attrIdx])) attrIdx++;
    const attrName = attrPart.slice(attrNameStart, attrIdx);

    if (!attrName) {
      attrIdx++;
      continue;
    }

    // Skip whitespace
    while (attrIdx < attrPart.length && /\s/.test(attrPart[attrIdx])) attrIdx++;

    let attrValue = '';
    if (attrIdx < attrPart.length && attrPart[attrIdx] === '=') {
      attrIdx++; // skip '='

      // Skip whitespace
      while (attrIdx < attrPart.length && /\s/.test(attrPart[attrIdx])) attrIdx++;

      // Parse value
      if (attrIdx < attrPart.length && (attrPart[attrIdx] === '"' || attrPart[attrIdx] === "'")) {
        const quote = attrPart[attrIdx];
        attrIdx++; // skip opening quote
        const valueStart = attrIdx;
        while (attrIdx < attrPart.length && attrPart[attrIdx] !== quote) attrIdx++;
        attrValue = attrPart.slice(valueStart, attrIdx);
        if (attrIdx < attrPart.length) attrIdx++; // skip closing quote
      } else {
        const valueStart = attrIdx;
        while (attrIdx < attrPart.length && !/\s/.test(attrPart[attrIdx])) attrIdx++;
        attrValue = attrPart.slice(valueStart, attrIdx);
      }
    }

    attributes.push({ name: attrName, value: attrValue });
  }

  return { tagName, isClosing, isSelfClosing, attributes };
}

/**
 * Sanitize attributes, removing dangerous ones.
 */
function sanitizeAttributes(attributes: Array<{ name: string; value: string }>): string {
  const safe: string[] = [];

  for (const { name, value } of attributes) {
    const nameLower = name.toLowerCase();

    // Skip event handlers
    if (nameLower.startsWith('on') || HTML_EVENT_HANDLERS.has(nameLower)) {
      continue;
    }

    // Check URL attributes for dangerous schemes
    if (['href', 'src', 'action', 'formaction', 'data', 'poster', 'codebase'].includes(nameLower)) {
      const valueLower = value.toLowerCase().trim();
      if (HTML_DANGEROUS_SCHEMES.some((scheme) => valueLower.startsWith(scheme))) {
        continue;
      }
    }

    // Check style for dangerous values
    if (nameLower === 'style') {
      const styleLower = value.toLowerCase();
      if (styleLower.includes('expression(') || styleLower.includes('javascript:') || styleLower.includes('url(')) {
        continue;
      }
    }

    // Escape value and add
    const escapedValue = value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    safe.push(` ${name}="${escapedValue}"`);
  }

  return safe.join('');
}
