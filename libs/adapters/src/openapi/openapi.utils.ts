import type { McpOpenAPITool, SecurityResolver } from 'mcp-from-openapi';

/**
 * Request configuration for building HTTP requests
 */
export interface RequestConfig {
  url: string;
  headers: Headers;
  body?: Record<string, unknown>;
}

/**
 * Coerce a value to string with type validation.
 * Throws if the value is an object/array that can't be safely stringified.
 *
 * @param value - Value to coerce
 * @param paramName - Parameter name for error messages
 * @param location - Parameter location (path/query/header)
 * @returns String representation of the value
 */
function coerceToString(value: unknown, paramName: string, location: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      // Arrays in query params are common - join with comma
      if (location === 'query') {
        return value.map(String).join(',');
      }
      throw new Error(`${location} parameter '${paramName}' cannot be an array. Received: ${JSON.stringify(value)}`);
    }
    throw new Error(`${location} parameter '${paramName}' cannot be an object. Received: ${JSON.stringify(value)}`);
  }
  return String(value);
}

/**
 * Validate and normalize a base URL.
 *
 * @param url - URL to validate
 * @returns Validated URL object
 * @throws Error if URL is invalid or uses unsupported protocol
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

/**
 * Append a cookie to the Cookie header.
 * Validates cookie name according to RFC 6265.
 *
 * @param headers - Headers object to modify
 * @param name - Cookie name
 * @param value - Cookie value (will be URI encoded)
 */
function appendCookie(headers: Headers, name: string, value: unknown): void {
  // RFC 6265 cookie-name validation (simplified)
  if (!/^[\w!#$%&'*+\-.^`|~]+$/.test(name)) {
    throw new Error(`Invalid cookie name: '${name}'. Cookie names must be valid tokens.`);
  }

  const existing = headers.get('Cookie') || '';
  const cookiePair = `${name}=${encodeURIComponent(coerceToString(value, name, 'cookie'))}`;
  const combined = existing ? `${existing}; ${cookiePair}` : cookiePair;
  headers.set('Cookie', combined);
}

/**
 * Build HTTP request from OpenAPI tool and input parameters
 *
 * @param tool - OpenAPI tool definition with mapper
 * @param input - User input parameters
 * @param security - Resolved security (headers, query params, etc.)
 * @param baseUrl - API base URL
 * @returns Request configuration ready for fetch
 */
export function buildRequest(
  tool: McpOpenAPITool,
  input: Record<string, unknown>,
  security: Awaited<ReturnType<SecurityResolver['resolve']>>,
  baseUrl: string,
): RequestConfig {
  // Normalize base URL by removing trailing slash to prevent double slashes
  // Validate server URL from OpenAPI spec to prevent SSRF attacks
  const rawBaseUrl = tool.metadata.servers?.[0]?.url || baseUrl;
  validateBaseUrl(rawBaseUrl); // Throws if invalid protocol (e.g., file://, javascript:)
  const apiBaseUrl = rawBaseUrl.replace(/\/+$/, '');
  let path = tool.metadata.path;
  const queryParams = new URLSearchParams();
  const headers = new Headers({
    accept: 'application/json',
    ...security.headers,
  });
  let body: Record<string, unknown> | undefined;

  // Process each mapper entry
  for (const mapper of tool.mapper) {
    // Skip security parameters (already handled by SecurityResolver)
    if (mapper.security) continue;

    const value = input[mapper.inputKey];

    // Check required parameters
    if (value === undefined || value === null) {
      if (mapper.required) {
        throw new Error(
          `Required ${mapper.type} parameter '${mapper.key}' (input: '${mapper.inputKey}') is missing for operation '${tool.name}'`,
        );
      }
      continue;
    }

    // Apply parameter to correct location
    switch (mapper.type) {
      case 'path':
        // Use replaceAll to handle duplicate path parameters (e.g., /users/{id}/posts/{id})
        path = path.replaceAll(`{${mapper.key}}`, encodeURIComponent(coerceToString(value, mapper.key, 'path')));
        break;

      case 'query':
        queryParams.set(mapper.key, coerceToString(value, mapper.key, 'query'));
        break;

      case 'header': {
        const headerValue = coerceToString(value, mapper.key, 'header');
        // Validate header values for injection attacks
        // Check for: CR, LF, null byte, form feed, vertical tab
        if (/[\r\n\x00\f\v]/.test(headerValue)) {
          throw new Error(
            `Invalid header value for '${mapper.key}': contains control characters (possible header injection attack)`,
          );
        }
        headers.set(mapper.key, headerValue);
        break;
      }

      case 'cookie':
        appendCookie(headers, mapper.key, value);
        break;

      case 'body':
        if (!body) body = {};
        body[mapper.key] = value;
        break;

      default:
        throw new Error(
          `Unknown mapper type '${(mapper as { type: string }).type}' for parameter '${mapper.key}' in operation '${
            tool.name
          }'`,
        );
    }
  }

  // Add query parameters from security (e.g., API keys in query string)
  // Detect collisions with user-provided query params (security params take precedence)
  Object.entries(security.query).forEach(([key, value]) => {
    if (queryParams.has(key)) {
      // Security params override user params, but warn about potential misconfiguration
      throw new Error(
        `Query parameter collision: '${key}' is provided both as user input and security parameter. ` +
          `This could indicate a security misconfiguration in operation '${tool.name}'.`,
      );
    }
    queryParams.set(key, coerceToString(value, key, 'security query'));
  });

  // Add cookies from a security context
  if (security.cookies && Object.keys(security.cookies).length > 0) {
    Object.entries(security.cookies).forEach(([key, value]) => {
      appendCookie(headers, key, value);
    });
  }

  // Ensure all path parameters are resolved
  if (path.includes('{')) {
    throw new Error(`Failed to resolve all path parameters in ${path} for operation ${tool.name}`);
  }

  // Build final URL
  const queryString = queryParams.toString();
  const url = `${apiBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;

  return { url, headers, body };
}

/**
 * Apply custom headers to request
 *
 * @param headers - Current headers
 * @param additionalHeaders - Additional static headers to add
 */
export function applyAdditionalHeaders(headers: Headers, additionalHeaders?: Record<string, string>): void {
  if (!additionalHeaders) return;

  Object.entries(additionalHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
}

/**
 * Options for response parsing
 */
export interface ParseResponseOptions {
  /** Maximum response size in bytes (default: 10MB) */
  maxResponseSize?: number;
}

/** Default max response size: 10MB */
const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * Parse API response based on content type
 *
 * @param response - Fetch response
 * @param options - Optional parsing options
 * @returns Parsed response data
 */
export async function parseResponse(response: Response, options?: ParseResponseOptions): Promise<{ data: unknown }> {
  const maxSize = options?.maxResponseSize ?? DEFAULT_MAX_RESPONSE_SIZE;

  // Check for error responses FIRST - don't expose response body in error
  // Only include status code, not statusText (which could contain sensitive info)
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  // Check Content-Length header first to avoid loading huge responses
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    // Check for NaN, Infinity (from very large numbers), and actual size limit
    if (!isNaN(length) && isFinite(length) && length > maxSize) {
      throw new Error(`Response size (${length} bytes) exceeds maximum allowed (${maxSize} bytes)`);
    }
    // If length is Infinity or NaN, we'll catch it in the actual byte size check below
  }

  // Read response body
  // NOTE: This size check occurs AFTER loading the full response into memory.
  // For responses without Content-Length headers, this provides defense-in-depth
  // (detecting oversized responses) but does not protect against memory exhaustion.
  // A streaming approach would be required for true memory protection, but adds
  // complexity. The Content-Length check above handles the common case.
  const text = await response.text();

  // Check actual byte size (Content-Length may be missing or incorrect)
  const byteSize = new TextEncoder().encode(text).length;
  if (byteSize > maxSize) {
    throw new Error(`Response size (${byteSize} bytes) exceeds maximum allowed (${maxSize} bytes)`);
  }

  // Parse JSON responses - use case-insensitive check
  const contentType = response.headers.get('content-type');
  if (contentType?.toLowerCase().includes('application/json')) {
    try {
      return { data: JSON.parse(text) };
    } catch {
      // Invalid JSON, return as text (don't log to console in production)
      return { data: text };
    }
  }

  // Return text for non-JSON responses
  return { data: text };
}
