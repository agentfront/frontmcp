/**
 * Handlebars Built-in Helpers
 *
 * Provides a collection of helper functions for Handlebars templates.
 * Includes formatting, escaping, conditionals, and iteration helpers.
 *
 * @packageDocumentation
 */

/**
 * Helper function type for Handlebars.
 * Allows any function signature since Handlebars helpers vary widely.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HelperFunction = (...args: any[]) => string | boolean | unknown;

/**
 * Escape HTML special characters to prevent XSS.
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML output
 *
 * @example
 * ```handlebars
 * {{escapeHtml output.userInput}}
 * ```
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) {
    return '';
  }

  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a date for display.
 *
 * @param date - Date object, ISO string, or timestamp
 * @param format - Optional format string (default: localized date)
 * @returns Formatted date string
 *
 * @example
 * ```handlebars
 * {{formatDate output.createdAt}}
 * {{formatDate output.createdAt "short"}}
 * {{formatDate output.createdAt "long"}}
 * ```
 */
export function formatDate(date: unknown, format?: string): string {
  if (date === null || date === undefined) {
    return '';
  }

  let dateObj: Date;

  if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string' || typeof date === 'number') {
    dateObj = new Date(date);
  } else {
    return String(date);
  }

  if (isNaN(dateObj.getTime())) {
    return String(date);
  }

  const options: Intl.DateTimeFormatOptions = {};

  switch (format) {
    case 'short':
      options.dateStyle = 'short';
      break;
    case 'medium':
      options.dateStyle = 'medium';
      break;
    case 'long':
      options.dateStyle = 'long';
      break;
    case 'full':
      options.dateStyle = 'full';
      break;
    case 'time':
      options.timeStyle = 'short';
      break;
    case 'datetime':
      options.dateStyle = 'medium';
      options.timeStyle = 'short';
      break;
    case 'iso':
      return dateObj.toISOString();
    case 'relative':
      return formatRelativeDate(dateObj);
    default:
      options.dateStyle = 'medium';
  }

  return new Intl.DateTimeFormat('en-US', options).format(dateObj);
}

/**
 * Format a date relative to now.
 */
function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return formatDate(date, 'medium');
  }
}

/**
 * Format a number as currency.
 *
 * @param amount - Numeric amount
 * @param currency - ISO 4217 currency code (default: 'USD')
 * @returns Formatted currency string
 *
 * @example
 * ```handlebars
 * {{formatCurrency output.price}}
 * {{formatCurrency output.price "EUR"}}
 * ```
 */
export function formatCurrency(amount: unknown, currency?: string): string {
  if (amount === null || amount === undefined) {
    return '';
  }

  const num = typeof amount === 'number' ? amount : parseFloat(String(amount));

  if (isNaN(num)) {
    return String(amount);
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: typeof currency === 'string' ? currency : 'USD',
  }).format(num);
}

/**
 * Format a number with locale-aware separators.
 *
 * @param value - Number to format
 * @param decimals - Number of decimal places (optional)
 * @returns Formatted number string
 *
 * @example
 * ```handlebars
 * {{formatNumber output.count}}
 * {{formatNumber output.percentage 2}}
 * ```
 */
export function formatNumber(value: unknown, decimals?: number): string {
  if (value === null || value === undefined) {
    return '';
  }

  const num = typeof value === 'number' ? value : parseFloat(String(value));

  if (isNaN(num)) {
    return String(value);
  }

  const options: Intl.NumberFormatOptions = {};
  if (typeof decimals === 'number') {
    options.minimumFractionDigits = decimals;
    options.maximumFractionDigits = decimals;
  }

  return new Intl.NumberFormat('en-US', options).format(num);
}

/**
 * Safely embed JSON data in HTML.
 * Escapes script-breaking characters.
 *
 * @param data - Data to serialize
 * @returns JSON string safe for embedding
 *
 * @example
 * ```handlebars
 * <script type="application/json" id="data">
 *   {{{jsonEmbed output}}}
 * </script>
 * ```
 */
export function jsonEmbed(data: unknown): string {
  const json = JSON.stringify(data ?? null);
  // Escape characters that could break out of script tags
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Convert data to JSON string.
 *
 * @param data - Data to serialize
 * @param pretty - Whether to pretty-print (optional)
 * @returns JSON string
 *
 * @example
 * ```handlebars
 * <pre>{{json output true}}</pre>
 * ```
 */
export function json(data: unknown, pretty?: boolean): string {
  return JSON.stringify(data ?? null, null, pretty ? 2 : undefined);
}

/**
 * Equality comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if values are equal
 *
 * @example
 * ```handlebars
 * {{#if (eq output.status "active")}}Active{{/if}}
 * ```
 */
export function eq(a: unknown, b: unknown): boolean {
  return a === b;
}

/**
 * Inequality comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if values are not equal
 *
 * @example
 * ```handlebars
 * {{#if (ne output.status "deleted")}}Visible{{/if}}
 * ```
 */
export function ne(a: unknown, b: unknown): boolean {
  return a !== b;
}

/**
 * Greater than comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a > b
 *
 * @example
 * ```handlebars
 * {{#if (gt output.count 10)}}Many items{{/if}}
 * ```
 */
export function gt(a: unknown, b: unknown): boolean {
  return Number(a) > Number(b);
}

/**
 * Greater than or equal comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a >= b
 */
export function gte(a: unknown, b: unknown): boolean {
  return Number(a) >= Number(b);
}

/**
 * Less than comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a < b
 *
 * @example
 * ```handlebars
 * {{#if (lt output.remaining 5)}}Running low{{/if}}
 * ```
 */
export function lt(a: unknown, b: unknown): boolean {
  return Number(a) < Number(b);
}

/**
 * Less than or equal comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a <= b
 */
export function lte(a: unknown, b: unknown): boolean {
  return Number(a) <= Number(b);
}

/**
 * Logical AND.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if both values are truthy
 *
 * @example
 * ```handlebars
 * {{#if (and output.enabled output.visible)}}Show content{{/if}}
 * ```
 */
export function and(a: unknown, b: unknown): boolean {
  return Boolean(a) && Boolean(b);
}

/**
 * Logical OR.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if either value is truthy
 *
 * @example
 * ```handlebars
 * {{#if (or output.featured output.promoted)}}Highlight{{/if}}
 * ```
 */
export function or(a: unknown, b: unknown): boolean {
  return Boolean(a) || Boolean(b);
}

/**
 * Logical NOT.
 *
 * @param value - Value to negate
 * @returns Negated boolean
 *
 * @example
 * ```handlebars
 * {{#if (not output.hidden)}}Visible{{/if}}
 * ```
 */
export function not(value: unknown): boolean {
  return !value;
}

/**
 * Get the first element of an array.
 *
 * @param arr - Array
 * @returns First element
 *
 * @example
 * ```handlebars
 * {{first output.items}}
 * ```
 */
export function first<T>(arr: T[]): T | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr[0];
}

/**
 * Get the last element of an array.
 *
 * @param arr - Array
 * @returns Last element
 *
 * @example
 * ```handlebars
 * {{last output.items}}
 * ```
 */
export function last<T>(arr: T[]): T | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr[arr.length - 1];
}

/**
 * Get the length of an array or string.
 *
 * @param value - Array or string
 * @returns Length
 *
 * @example
 * ```handlebars
 * {{length output.items}} items
 * ```
 */
export function length(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') return value.length;
  return 0;
}

/**
 * Check if a value is in an array.
 *
 * @param arr - Array to search
 * @param value - Value to find
 * @returns true if value is in array
 *
 * @example
 * ```handlebars
 * {{#if (includes output.tags "featured")}}Featured{{/if}}
 * ```
 */
export function includes(arr: unknown, value: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.includes(value);
}

/**
 * Join array elements with a separator.
 *
 * @param arr - Array to join
 * @param separator - Separator string (default: ', ')
 * @returns Joined string
 *
 * @example
 * ```handlebars
 * {{join output.tags ", "}}
 * ```
 */
export function join(arr: unknown, separator?: string): string {
  if (!Array.isArray(arr)) return '';
  return arr.join(typeof separator === 'string' ? separator : ', ');
}

/**
 * Convert to uppercase.
 *
 * @param str - String to convert
 * @returns Uppercase string
 *
 * @example
 * ```handlebars
 * {{uppercase output.status}}
 * ```
 */
export function uppercase(str: unknown): string {
  return String(str ?? '').toUpperCase();
}

/**
 * Convert to lowercase.
 *
 * @param str - String to convert
 * @returns Lowercase string
 *
 * @example
 * ```handlebars
 * {{lowercase output.name}}
 * ```
 */
export function lowercase(str: unknown): string {
  return String(str ?? '').toLowerCase();
}

/**
 * Capitalize the first letter.
 *
 * @param str - String to capitalize
 * @returns Capitalized string
 *
 * @example
 * ```handlebars
 * {{capitalize output.name}}
 * ```
 */
export function capitalize(str: unknown): string {
  const s = String(str ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Truncate a string to a maximum length.
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add if truncated (default: '...')
 * @returns Truncated string
 *
 * @example
 * ```handlebars
 * {{truncate output.description 100}}
 * ```
 */
export function truncate(str: unknown, maxLength?: number, suffix?: string): string {
  const s = String(str ?? '');
  const len = typeof maxLength === 'number' ? maxLength : 50;
  const suf = typeof suffix === 'string' ? suffix : '...';

  if (s.length <= len) return s;
  return s.slice(0, len - suf.length) + suf;
}

/**
 * Provide a default value if the input is falsy.
 *
 * @param value - Value to check
 * @param defaultValue - Default value if falsy
 * @returns Value or default
 *
 * @example
 * ```handlebars
 * {{default output.name "Unknown"}}
 * ```
 */
export function defaultValue(value: unknown, defaultValue: unknown): unknown {
  return value || defaultValue;
}

/**
 * Generate a unique ID.
 *
 * @param prefix - Optional prefix
 * @returns Unique ID string
 *
 * @example
 * ```handlebars
 * <div id="{{uniqueId 'widget'}}">...</div>
 * ```
 */
let idCounter = 0;
export function uniqueId(prefix?: string): string {
  const id = ++idCounter;
  return prefix ? `${prefix}-${id}` : `id-${id}`;
}

/**
 * Reset the unique ID counter (for testing).
 */
export function resetUniqueIdCounter(): void {
  idCounter = 0;
}

/**
 * Conditionally join class names.
 *
 * @param classes - Class names (falsy values are filtered)
 * @returns Space-separated class string
 *
 * @example
 * ```handlebars
 * <div class="{{classNames 'base' (if active 'active') (if disabled 'disabled')}}">
 * ```
 */
export function classNames(...classes: unknown[]): string {
  return classes.filter(Boolean).map(String).join(' ');
}

/**
 * Collection of all built-in helpers.
 */
export const builtinHelpers: Record<string, HelperFunction> = {
  // Escaping
  escapeHtml,

  // Formatting
  formatDate,
  formatCurrency,
  formatNumber,
  json,
  jsonEmbed,

  // Comparison
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,

  // Logical
  and,
  or,
  not,

  // Array
  first,
  last,
  length,
  includes,
  join,

  // String
  uppercase,
  lowercase,
  capitalize,
  truncate,

  // Utility
  default: defaultValue,
  uniqueId,
  classNames,
};
