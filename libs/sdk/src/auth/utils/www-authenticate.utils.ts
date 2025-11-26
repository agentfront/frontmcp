// auth/utils/www-authenticate.utils.ts

/**
 * WWW-Authenticate Header Builder
 *
 * Implements RFC 9728 (OAuth 2.0 Protected Resource Metadata) and
 * RFC 6750 (Bearer Token Usage) compliant WWW-Authenticate headers.
 */

/**
 * Error codes per RFC 6750 Section 3.1
 */
export type BearerErrorCode = 'invalid_request' | 'invalid_token' | 'insufficient_scope';

/**
 * Options for building WWW-Authenticate header
 */
export interface WwwAuthenticateOptions {
  /**
   * The resource_metadata URL pointing to the PRM document
   * Per RFC 9728, this is the primary mechanism for resource discovery
   */
  resourceMetadataUrl?: string;

  /**
   * OAuth 2.0 realm (optional per RFC 6750)
   */
  realm?: string;

  /**
   * Required scopes for the resource (space-delimited)
   */
  scope?: string | string[];

  /**
   * Error code when authentication fails
   */
  error?: BearerErrorCode;

  /**
   * Human-readable error description
   */
  errorDescription?: string;

  /**
   * Error URI pointing to additional information
   */
  errorUri?: string;
}

/**
 * Build a WWW-Authenticate header for Bearer authentication
 *
 * @param options - Header options
 * @returns The formatted WWW-Authenticate header value
 *
 * @example
 * ```typescript
 * // Basic protected resource metadata header
 * buildWwwAuthenticate({
 *   resourceMetadataUrl: 'https://api.example.com/.well-known/oauth-protected-resource',
 * });
 * // => 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"'
 *
 * // With error information
 * buildWwwAuthenticate({
 *   resourceMetadataUrl: 'https://api.example.com/.well-known/oauth-protected-resource',
 *   error: 'insufficient_scope',
 *   scope: ['read', 'write'],
 *   errorDescription: 'Additional permissions required',
 * });
 * // => 'Bearer resource_metadata="...", error="insufficient_scope", scope="read write", error_description="..."'
 * ```
 */
export function buildWwwAuthenticate(options: WwwAuthenticateOptions = {}): string {
  const parts: string[] = ['Bearer'];
  const params: string[] = [];

  // Resource metadata URL (RFC 9728)
  if (options.resourceMetadataUrl) {
    params.push(`resource_metadata="${escapeQuotedString(options.resourceMetadataUrl)}"`);
  }

  // Realm (RFC 6750)
  if (options.realm) {
    params.push(`realm="${escapeQuotedString(options.realm)}"`);
  }

  // Error code (RFC 6750)
  if (options.error) {
    params.push(`error="${options.error}"`);
  }

  // Error description (RFC 6750)
  if (options.errorDescription) {
    params.push(`error_description="${escapeQuotedString(options.errorDescription)}"`);
  }

  // Error URI (RFC 6750)
  if (options.errorUri) {
    params.push(`error_uri="${escapeQuotedString(options.errorUri)}"`);
  }

  // Scope (RFC 6750) - space-delimited
  if (options.scope) {
    const scopeValue = Array.isArray(options.scope) ? options.scope.join(' ') : options.scope;
    params.push(`scope="${escapeQuotedString(scopeValue)}"`);
  }

  if (params.length > 0) {
    parts.push(params.join(', '));
  }

  return parts.join(' ');
}

/**
 * Build the Protected Resource Metadata URL for a given base URL and path
 *
 * @param baseUrl - The server base URL
 * @param entryPath - The entry path prefix
 * @param routeBase - The route base path
 * @returns The full PRM URL
 */
export function buildPrmUrl(baseUrl: string, entryPath: string, routeBase: string): string {
  const normalizedEntry = normalizePathSegment(entryPath);
  const normalizedRoute = normalizePathSegment(routeBase);
  return `${baseUrl}/.well-known/oauth-protected-resource${normalizedEntry}${normalizedRoute}`;
}

/**
 * Build WWW-Authenticate header for unauthorized requests (no token)
 */
export function buildUnauthorizedHeader(prmUrl: string): string {
  return buildWwwAuthenticate({
    resourceMetadataUrl: prmUrl,
  });
}

/**
 * Build WWW-Authenticate header for invalid token errors
 */
export function buildInvalidTokenHeader(prmUrl: string, description?: string): string {
  return buildWwwAuthenticate({
    resourceMetadataUrl: prmUrl,
    error: 'invalid_token',
    errorDescription: description ?? 'The access token is invalid or expired',
  });
}

/**
 * Build WWW-Authenticate header for insufficient scope errors
 */
export function buildInsufficientScopeHeader(prmUrl: string, requiredScopes: string[], description?: string): string {
  return buildWwwAuthenticate({
    resourceMetadataUrl: prmUrl,
    error: 'insufficient_scope',
    scope: requiredScopes,
    errorDescription: description ?? 'The request requires higher privileges',
  });
}

/**
 * Build WWW-Authenticate header for invalid request errors
 */
export function buildInvalidRequestHeader(prmUrl: string, description?: string): string {
  return buildWwwAuthenticate({
    resourceMetadataUrl: prmUrl,
    error: 'invalid_request',
    errorDescription: description ?? 'The request is missing required parameters',
  });
}

/**
 * Parse a WWW-Authenticate header value
 *
 * @param header - The WWW-Authenticate header value
 * @returns Parsed header options
 */
export function parseWwwAuthenticate(header: string): WwwAuthenticateOptions {
  const result: WwwAuthenticateOptions = {};

  // Check for Bearer scheme
  if (!header.toLowerCase().startsWith('bearer')) {
    return result;
  }

  // Extract parameters
  const paramString = header.substring(6).trim();
  const paramRegex = /(\w+)="([^"\\]*(?:\\.[^"\\]*)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = paramRegex.exec(paramString)) !== null) {
    const [, key, value] = match;
    const unescapedValue = unescapeQuotedString(value);

    switch (key.toLowerCase()) {
      case 'resource_metadata':
        result.resourceMetadataUrl = unescapedValue;
        break;
      case 'realm':
        result.realm = unescapedValue;
        break;
      case 'error':
        result.error = unescapedValue as BearerErrorCode;
        break;
      case 'error_description':
        result.errorDescription = unescapedValue;
        break;
      case 'error_uri':
        result.errorUri = unescapedValue;
        break;
      case 'scope':
        result.scope = unescapedValue;
        break;
    }
  }

  return result;
}

/**
 * Escape special characters for quoted-string per RFC 7230
 */
function escapeQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Unescape quoted-string per RFC 7230
 */
function unescapeQuotedString(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

/**
 * Normalize a path segment (ensure leading slash, no trailing slash)
 */
function normalizePathSegment(path: string): string {
  if (!path || path === '/') return '';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized.replace(/\/+$/, '');
}
