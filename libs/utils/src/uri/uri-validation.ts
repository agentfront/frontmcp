/**
 * URI validation utilities.
 *
 * Provides RFC 3986 compliant URI validation including scheme validation
 * and extraction. These utilities are commonly used for validating resource URIs.
 */

/**
 * RFC 3986 compliant URI scheme pattern.
 * scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
 *
 * The pattern validates that the URI:
 * 1. Starts with a letter (case insensitive)
 * 2. Followed by any combination of letters, digits, +, -, or .
 * 3. Followed by ://
 */
const RFC_3986_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Pattern to extract the scheme from a URI.
 */
const SCHEME_EXTRACT_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Validate that a URI has a valid scheme per RFC 3986.
 *
 * @param uri - The URI to validate
 * @returns true if the URI has a valid scheme, false otherwise
 *
 * @example
 * isValidMcpUri('file:///path/to/file') // true
 * isValidMcpUri('https://example.com/resource') // true
 * isValidMcpUri('custom://my-resource') // true
 * isValidMcpUri('/path/to/file') // false (no scheme)
 * isValidMcpUri('123://invalid') // false (scheme must start with letter)
 */
export function isValidMcpUri(uri: string): boolean {
  return RFC_3986_SCHEME_PATTERN.test(uri);
}

/**
 * Extract the scheme from a URI.
 *
 * @param uri - The URI to extract the scheme from
 * @returns The scheme in lowercase, or null if no valid scheme found
 *
 * @example
 * extractUriScheme('file:///path') // 'file'
 * extractUriScheme('HTTPS://example.com') // 'https'
 * extractUriScheme('/no/scheme') // null
 */
export function extractUriScheme(uri: string): string | null {
  const match = uri.match(SCHEME_EXTRACT_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Validate that a URI template has a valid scheme per RFC 3986.
 * URI templates follow RFC 6570 and can contain template expressions like {var}.
 * The scheme portion should still be a valid static scheme.
 *
 * @param uriTemplate - The URI template to validate
 * @returns true if the URI template has a valid scheme, false otherwise
 *
 * @example
 * isValidMcpUriTemplate('users://{userId}/profile') // true
 * isValidMcpUriTemplate('file:///{path}') // true
 * isValidMcpUriTemplate('{scheme}://dynamic') // false (scheme must be static)
 */
export function isValidMcpUriTemplate(uriTemplate: string): boolean {
  // For templates, we just need to check if it starts with a valid scheme
  // The template expressions come after the scheme
  return RFC_3986_SCHEME_PATTERN.test(uriTemplate);
}
