/**
 * CIMD (Client ID Metadata Documents) Error Classes
 *
 * Standalone error classes for CIMD-specific failures.
 * These do not depend on the SDK's error classes.
 */

/**
 * Base class for all CIMD-related errors.
 *
 * Provides a consistent API with code, statusCode, and getPublicMessage()
 * that mirrors the SDK's PublicMcpError but without the dependency.
 */
export abstract class CimdError extends Error {
  /**
   * Error code for machine-readable identification.
   */
  readonly code: string;

  /**
   * HTTP status code to return when this error occurs.
   */
  readonly statusCode: number;

  /**
   * The client_id URL that caused the error.
   */
  readonly clientIdUrl?: string;

  constructor(message: string, code: string, statusCode: number, clientIdUrl?: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.clientIdUrl = clientIdUrl;

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get a message safe to return to clients.
   * Override in subclasses to provide user-friendly messages.
   */
  getPublicMessage(): string {
    return this.message;
  }
}

/**
 * Thrown when the client_id URL is invalid.
 *
 * Examples:
 * - HTTP URL instead of HTTPS
 * - Missing path component
 * - Invalid URL format
 */
export class InvalidClientIdUrlError extends CimdError {
  readonly reason: string;

  constructor(clientIdUrl: string, reason: string) {
    super(`Invalid CIMD client_id URL: ${reason}`, 'INVALID_CLIENT_ID_URL', 400, clientIdUrl);
    this.reason = reason;
  }

  override getPublicMessage(): string {
    return `Invalid client_id URL: ${this.reason}`;
  }
}

/**
 * Thrown when fetching the CIMD document fails.
 *
 * Examples:
 * - Network timeout
 * - HTTP error (404, 500, etc.)
 * - Connection refused
 */
export class CimdFetchError extends CimdError {
  readonly httpStatus?: number;
  readonly originalError?: Error;

  constructor(clientIdUrl: string, message: string, options?: { httpStatus?: number; originalError?: Error }) {
    super(`Failed to fetch CIMD document from ${clientIdUrl}: ${message}`, 'CIMD_FETCH_ERROR', 502, clientIdUrl);
    this.httpStatus = options?.httpStatus;
    this.originalError = options?.originalError;
  }

  override getPublicMessage(): string {
    if (this.httpStatus) {
      return `Failed to fetch client metadata: HTTP ${this.httpStatus}`;
    }
    return 'Failed to fetch client metadata document';
  }
}

/**
 * Thrown when the CIMD document fails validation.
 *
 * Examples:
 * - Missing required fields
 * - Invalid field values
 * - client_id in document doesn't match URL
 */
export class CimdValidationError extends CimdError {
  readonly validationErrors: string[];

  constructor(clientIdUrl: string, errors: string[]) {
    super(`CIMD document validation failed: ${errors.join('; ')}`, 'CIMD_VALIDATION_ERROR', 400, clientIdUrl);
    this.validationErrors = errors;
  }

  override getPublicMessage(): string {
    return `Client metadata document validation failed: ${this.validationErrors.join('; ')}`;
  }
}

/**
 * Thrown when the client_id in the document doesn't match the URL.
 *
 * Per CIMD spec, the client_id field in the document MUST exactly match
 * the URL from which the document was fetched.
 */
export class CimdClientIdMismatchError extends CimdError {
  readonly documentClientId: string;

  constructor(urlClientId: string, documentClientId: string) {
    super(
      `CIMD client_id mismatch: URL is "${urlClientId}" but document contains "${documentClientId}"`,
      'CIMD_CLIENT_ID_MISMATCH',
      400,
      urlClientId,
    );
    this.documentClientId = documentClientId;
  }

  override getPublicMessage(): string {
    return 'Client ID in metadata document does not match the request';
  }
}

/**
 * Thrown when SSRF protection blocks a client_id URL.
 *
 * Examples:
 * - Private IP address
 * - Blocked domain
 * - Link-local address
 */
export class CimdSecurityError extends CimdError {
  readonly securityReason: string;

  constructor(clientIdUrl: string, reason: string) {
    super(`CIMD security check failed for ${clientIdUrl}: ${reason}`, 'CIMD_SECURITY_ERROR', 403, clientIdUrl);
    this.securityReason = reason;
  }

  override getPublicMessage(): string {
    return 'Client ID URL is not allowed by security policy';
  }
}

/**
 * Thrown when the redirect_uri doesn't match any in the CIMD document.
 */
export class RedirectUriMismatchError extends CimdError {
  readonly requestedRedirectUri: string;
  readonly allowedRedirectUris: string[];

  constructor(clientIdUrl: string, requestedRedirectUri: string, allowedRedirectUris: string[]) {
    super(
      `Redirect URI "${requestedRedirectUri}" is not registered for client "${clientIdUrl}"`,
      'REDIRECT_URI_MISMATCH',
      400,
      clientIdUrl,
    );
    this.requestedRedirectUri = requestedRedirectUri;
    this.allowedRedirectUris = allowedRedirectUris;
  }

  override getPublicMessage(): string {
    return 'The redirect_uri is not registered for this client';
  }
}

/**
 * Thrown when the CIMD response exceeds the maximum allowed size.
 */
export class CimdResponseTooLargeError extends CimdError {
  readonly maxBytes: number;
  readonly actualBytes?: number;

  constructor(clientIdUrl: string, maxBytes: number, actualBytes?: number) {
    super(
      `CIMD response from ${clientIdUrl} exceeds maximum size of ${maxBytes} bytes${
        actualBytes ? ` (received ${actualBytes} bytes)` : ''
      }`,
      'CIMD_RESPONSE_TOO_LARGE',
      502,
      clientIdUrl,
    );
    this.maxBytes = maxBytes;
    this.actualBytes = actualBytes;
  }

  override getPublicMessage(): string {
    return 'Client metadata document is too large';
  }
}

/**
 * Thrown when CIMD is disabled but a CIMD client_id is used.
 */
export class CimdDisabledError extends CimdError {
  constructor() {
    super('CIMD (Client ID Metadata Documents) is disabled on this server', 'CIMD_DISABLED', 400);
  }
}
