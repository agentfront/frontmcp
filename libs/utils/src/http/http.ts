/**
 * HTTP utilities for URL validation and request handling.
 *
 * Provides security-focused validation for URLs and HTTP operations.
 */

/**
 * Validate and normalize a base URL.
 * Only allows http: and https: protocols to prevent SSRF attacks.
 *
 * @param url - URL string to validate
 * @returns Validated URL object
 * @throws Error if URL is invalid or uses unsupported protocol
 *
 * @example
 * validateBaseUrl('https://api.example.com') // URL object
 * validateBaseUrl('http://localhost:3000') // URL object
 * validateBaseUrl('file:///etc/passwd') // throws Error
 * validateBaseUrl('javascript:alert(1)') // throws Error
 */
export function validateBaseUrl(url: string): URL {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}. Only http: and https: are supported.`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unsupported protocol')) {
      throw err;
    }
    throw new Error(`Invalid base URL: ${url}`);
  }
}
