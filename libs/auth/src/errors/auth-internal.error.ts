import { randomBytes, bytesToHex } from '@frontmcp/utils';

/**
 * Base class for internal auth errors.
 * Mirrors SDK's InternalMcpError structure but lives in @frontmcp/auth
 * to avoid circular dependencies.
 */
export abstract class AuthInternalError extends Error {
  /**
   * Unique error ID for tracking in logs.
   */
  readonly errorId: string;

  /**
   * Whether this error should expose details to the client.
   */
  readonly isPublic = false;

  /**
   * HTTP status code equivalent.
   */
  readonly statusCode = 500;

  /**
   * Error code for categorization.
   */
  readonly code: string;

  protected constructor(message: string, code = 'AUTH_INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.errorId = `err_${bytesToHex(randomBytes(8))}`;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get the public-facing error message.
   */
  getPublicMessage(): string {
    return `Internal auth error. Please contact support with error ID: ${this.errorId}`;
  }

  /**
   * Get the internal error message (for logging).
   */
  getInternalMessage(): string {
    return this.message;
  }
}
