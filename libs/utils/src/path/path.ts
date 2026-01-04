/**
 * Path utilities for URL and file path manipulation.
 *
 * Provides common operations for normalizing and joining path segments.
 */

/**
 * Trim leading and trailing slashes from a string.
 *
 * @param s - The string to trim
 * @returns String with leading/trailing slashes removed
 *
 * @example
 * trimSlashes('/path/to/resource/') // 'path/to/resource'
 * trimSlashes('no-slashes') // 'no-slashes'
 * trimSlashes('///multiple///') // 'multiple'
 */
export function trimSlashes(s: string): string {
  return (s ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * Join URL path segments with a single slash and no trailing slash.
 * Empty segments are filtered out.
 *
 * @param parts - Path segments to join
 * @returns Joined path starting with / or empty string
 *
 * @example
 * joinPath('api', 'v1', 'users') // '/api/v1/users'
 * joinPath('/api/', '/v1/', '/users/') // '/api/v1/users'
 * joinPath('', 'path', '') // '/path'
 * joinPath() // ''
 */
export function joinPath(...parts: string[]): string {
  const cleaned = parts.map((p) => trimSlashes(p)).filter(Boolean);
  return cleaned.length ? `/${cleaned.join('/')}` : '';
}
