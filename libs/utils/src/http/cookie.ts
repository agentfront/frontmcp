/**
 * Cookie Utilities
 *
 * Browser-safe cookie building, parsing, and extraction.
 * Auto-detects Secure flag based on environment (localhost, HTTPS, browser).
 */

import { isNode } from '../crypto/runtime';

// ============================================
// Types
// ============================================

/**
 * Options for building a Set-Cookie header value.
 */
export interface CookieOptions {
  /** Cookie name */
  name: string;
  /** Cookie value */
  value: string;
  /** Cookie path (default: '/') */
  path?: string;
  /** Max age in seconds (default: 86400 = 24h) */
  maxAge?: number;
  /** HttpOnly flag — prevents JS access (default: true) */
  httpOnly?: boolean;
  /** SameSite policy (default: 'Strict') */
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** Secure flag — if omitted, auto-detected from request context */
  secure?: boolean;
  /** Domain for the cookie (default: omitted = current domain) */
  domain?: string;
}

// ============================================
// Localhost Detection
// ============================================

const LOCALHOST_PATTERNS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * Check if a host string is localhost.
 * Matches: localhost, 127.0.0.1, ::1, 0.0.0.0 (with or without port).
 */
export function isLocalhost(host: string | undefined): boolean {
  if (!host) return false;
  // Handle IPv6 in brackets (e.g., "[::1]:3000")
  if (host.startsWith('[')) {
    const closeBracket = host.indexOf(']');
    if (closeBracket > 0) {
      return LOCALHOST_PATTERNS.has(host.slice(1, closeBracket));
    }
  }
  // Check full value first (handles "::1" without port)
  if (LOCALHOST_PATTERNS.has(host)) return true;
  // Strip port for host:port format (e.g., "localhost:3000")
  const lastColon = host.lastIndexOf(':');
  if (lastColon > 0) {
    const hostname = host.slice(0, lastColon);
    return LOCALHOST_PATTERNS.has(hostname);
  }
  return false;
}

// ============================================
// Secure Request Detection
// ============================================

/**
 * Minimal request shape for secure detection.
 * Works with Express, Koa, raw Node.js, and plain objects.
 */
export interface SecureDetectionRequest {
  headers?: Record<string, string | string[] | undefined>;
  protocol?: string;
  socket?: { encrypted?: boolean };
}

/**
 * Detect if a request was made over HTTPS.
 * Checks (in order): protocol field, X-Forwarded-Proto header, socket.encrypted.
 */
export function isSecureRequest(req?: SecureDetectionRequest): boolean {
  if (!req) return false;
  if (req.protocol === 'https') return true;

  const forwarded = req.headers?.['x-forwarded-proto'];
  const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (forwardedStr === 'https') return true;

  if (req.socket?.encrypted) return true;

  return false;
}

// ============================================
// Cookie Building
// ============================================

/**
 * Build a Set-Cookie header value.
 *
 * Auto-detects the Secure flag based on environment:
 * - Browser: returns `null` (server-side cookies don't apply)
 * - localhost/127.0.0.1: omits Secure (dev mode works over HTTP)
 * - HTTPS request: sets Secure
 * - No request context: sets Secure in production, omits in development
 *
 * @param options - Cookie options
 * @param req - Optional request for auto-detecting Secure and localhost
 * @returns Set-Cookie header value, or `null` if cookies don't apply (browser-only environment)
 */
export function buildSetCookie(options: CookieOptions, req?: SecureDetectionRequest): string | null {
  // In pure browser environments (no Node.js), server-side cookies don't apply
  if (!isNode()) return null;

  const { name, value, path = '/', maxAge = 86400, httpOnly = true, sameSite = 'Strict', domain } = options;

  // Determine Secure flag
  let secure: boolean;
  if (options.secure !== undefined) {
    secure = options.secure;
  } else {
    const host = req?.headers?.['host'];
    const hostStr = Array.isArray(host) ? host[0] : host;
    if (isLocalhost(hostStr)) {
      secure = false;
    } else if (req) {
      secure = isSecureRequest(req);
    } else {
      // No request context — default to Secure in production
      secure = process.env['NODE_ENV'] === 'production';
    }
  }

  // Build cookie string
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${path}`);
  parts.push(`Max-Age=${maxAge}`);

  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  if (domain) parts.push(`Domain=${domain}`);

  return parts.join('; ');
}

// ============================================
// Cookie Parsing
// ============================================

/**
 * Parse a Cookie header string into key-value pairs.
 * Works in both Node.js and browser environments.
 *
 * @param cookieHeader - The Cookie header value (e.g., "name=value; other=123")
 * @returns Record of cookie name to value
 */
export function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    try {
      const name = decodeURIComponent(pair.slice(0, eqIdx).trim());
      const value = decodeURIComponent(pair.slice(eqIdx + 1).trim());
      if (name) cookies[name] = value;
    } catch {
      continue;
    }
  }

  return cookies;
}

/**
 * Extract a specific cookie value from a Cookie header string.
 *
 * @param cookieHeader - The Cookie header value
 * @param name - Cookie name to find
 * @returns The cookie value, or undefined if not found
 */
export function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  return parseCookies(cookieHeader)[name];
}
