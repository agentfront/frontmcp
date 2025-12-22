/**
 * Handlebars Built-in Helpers
 *
 * Provides a collection of helper functions for Handlebars templates.
 * Includes formatting, escaping, conditionals, and iteration helpers.
 *
 * @packageDocumentation
 */
import { escapeHtml } from '../utils';
/**
 * Helper function type for Handlebars.
 * Allows any function signature since Handlebars helpers vary widely.
 */
export type HelperFunction = (...args: any[]) => string | boolean | unknown;
export { escapeHtml };
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
export declare function formatDate(date: unknown, format?: string): string;
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
export declare function formatCurrency(amount: unknown, currency?: string): string;
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
export declare function formatNumber(value: unknown, decimals?: number): string;
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
export declare function jsonEmbed(data: unknown): string;
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
export declare function json(data: unknown, pretty?: boolean): string;
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
export declare function eq(a: unknown, b: unknown): boolean;
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
export declare function ne(a: unknown, b: unknown): boolean;
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
export declare function gt(a: unknown, b: unknown): boolean;
/**
 * Greater than or equal comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a >= b
 */
export declare function gte(a: unknown, b: unknown): boolean;
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
export declare function lt(a: unknown, b: unknown): boolean;
/**
 * Less than or equal comparison.
 *
 * @param a - First value
 * @param b - Second value
 * @returns true if a <= b
 */
export declare function lte(a: unknown, b: unknown): boolean;
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
export declare function and(a: unknown, b: unknown): boolean;
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
export declare function or(a: unknown, b: unknown): boolean;
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
export declare function not(value: unknown): boolean;
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
export declare function first<T>(arr: T[]): T | undefined;
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
export declare function last<T>(arr: T[]): T | undefined;
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
export declare function length(value: unknown): number;
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
export declare function includes(arr: unknown, value: unknown): boolean;
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
export declare function join(arr: unknown, separator?: string): string;
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
export declare function uppercase(str: unknown): string;
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
export declare function lowercase(str: unknown): string;
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
export declare function capitalize(str: unknown): string;
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
export declare function truncate(str: unknown, maxLength?: number, suffix?: string): string;
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
export declare function defaultValue(value: unknown, defaultValue: unknown): unknown;
export declare function uniqueId(prefix?: string): string;
/**
 * Reset the unique ID counter (for testing).
 */
export declare function resetUniqueIdCounter(): void;
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
export declare function classNames(...classes: unknown[]): string;
/**
 * Collection of all built-in helpers.
 */
export declare const builtinHelpers: Record<string, HelperFunction>;
//# sourceMappingURL=helpers.d.ts.map
