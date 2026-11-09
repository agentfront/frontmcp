import { bytesToHex, randomBytes } from '@frontmcp/utils';

/**
 * Base class for @frontmcp/auth's errors. Lives here to avoid a circular dependency on the SDK, which answers
 * a request that fails with one under its `code`, and with its message only when it `isPublic`.
 */
export abstract class AuthInternalError extends Error {
  /**
   * Unique error ID for tracking in logs.
   */
  readonly errorId: string;

  /**
   * Whether the client sees the message: true only for an error that names a setting and nothing secret.
   */
  readonly isPublic: boolean = false;

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
    if (this.isPublic) return this.message;
    return `Internal auth error. Please contact support with error ID: ${this.errorId}`;
  }

  /**
   * Get the internal error message (for logging).
   */
  getInternalMessage(): string {
    return this.message;
  }
}
