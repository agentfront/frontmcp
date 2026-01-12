/**
 * Metadata Utilities
 *
 * Shared utilities for extracting request metadata from HTTP headers.
 */

import type { RequestMetadata } from './frontmcp-context';

/**
 * Extract request metadata from headers.
 *
 * @param headers - HTTP headers object
 * @returns Extracted metadata including user-agent, content-type, client IP, and custom headers
 */
export function extractMetadata(headers: Record<string, unknown>): RequestMetadata {
  const customHeaders: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase().startsWith('x-frontmcp-') && typeof value === 'string') {
      customHeaders[key.toLowerCase()] = value;
    }
  }

  return {
    userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : undefined,
    contentType: typeof headers['content-type'] === 'string' ? headers['content-type'] : undefined,
    accept: typeof headers['accept'] === 'string' ? headers['accept'] : undefined,
    clientIp: extractClientIp(headers),
    customHeaders,
  };
}

/**
 * Extract client IP from headers.
 *
 * Handles both string and array header values (some adapters pass arrays).
 * Supports x-forwarded-for (comma-separated list) and x-real-ip headers.
 *
 * @param headers - HTTP headers object
 * @returns Client IP address or undefined if not found
 */
export function extractClientIp(headers: Record<string, unknown>): string | undefined {
  // x-forwarded-for can be comma-separated list; first is client IP
  const xff = headers['x-forwarded-for'];
  if (typeof xff === 'string') {
    return xff.split(',')[0]?.trim();
  }
  // Some adapters pass arrays for multi-value headers
  if (Array.isArray(xff) && typeof xff[0] === 'string') {
    return xff[0].split(',')[0]?.trim();
  }

  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }
  if (Array.isArray(realIp) && typeof realIp[0] === 'string') {
    return realIp[0];
  }

  return undefined;
}
