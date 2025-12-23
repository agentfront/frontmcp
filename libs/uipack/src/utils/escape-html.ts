/**
 * HTML Escaping Utilities
 *
 * Functions for escaping strings to prevent XSS attacks in HTML output.
 *
 * @packageDocumentation
 */

/**
 * Escape HTML special characters to prevent XSS.
 *
 * Handles null/undefined by returning empty string.
 * Converts non-string values to string before escaping.
 *
 * @param str - Value to escape (will be converted to string)
 * @returns Escaped string safe for HTML content
 *
 * @example
 * ```typescript
 * escapeHtml('<script>alert("xss")</script>')
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 *
 * escapeHtml(null)  // Returns: ''
 * escapeHtml(123)   // Returns: '123'
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
    .replace(/'/g, '&#39;')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape string for use in HTML attributes.
 *
 * Lighter version that only escapes & and " characters,
 * suitable for attribute values that are already quoted.
 *
 * @param str - String to escape
 * @returns Escaped string safe for HTML attributes
 *
 * @example
 * ```typescript
 * escapeHtmlAttr('value with "quotes" & ampersand')
 * // Returns: 'value with &quot;quotes&quot; &amp; ampersand'
 * ```
 */
export function escapeHtmlAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Escape string for use in JavaScript string literals.
 *
 * Escapes characters that could break out of a JS string context.
 *
 * @param str - String to escape
 * @returns Escaped string safe for JS string literals
 *
 * @example
 * ```typescript
 * escapeJsString("it's a \"test\"")
 * // Returns: "it\\'s a \\\"test\\\""
 * ```
 */
export function escapeJsString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Escape script closing tags in JSON strings to prevent XSS.
 *
 * When embedding JSON in a <script> tag, the string `</script>` will
 * prematurely close the script block. This function escapes the closing
 * tag by replacing `</` with `<\/`.
 *
 * @param jsonString - JSON string (already passed through JSON.stringify)
 * @returns Escaped JSON string safe for embedding in script tags
 *
 * @example
 * ```typescript
 * const json = JSON.stringify({ html: '</script><script>alert(1)</script>' });
 * escapeScriptClose(json);
 * // Returns: '{"html":"<\\/script><script>alert(1)<\\/script>"}'
 * ```
 */
export function escapeScriptClose(jsonString: string): string {
  return jsonString.replace(/<\//g, '<\\/');
}
