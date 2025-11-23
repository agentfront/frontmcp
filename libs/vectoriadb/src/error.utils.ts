/**
 * Error message sanitization utilities
 * Prevents information disclosure in production environments
 */

/**
 * Sanitizes an error message for production use
 * Removes potentially sensitive information like file paths, IDs, etc.
 *
 * @param error - The error object or message
 * @param genericMessage - The generic message to use in production
 * @param verboseErrors - Whether to return verbose error messages
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(error: Error | string, genericMessage: string, verboseErrors = true): string {
  if (verboseErrors) {
    return typeof error === 'string' ? error : error.message;
  }

  // In production mode, return generic message
  return genericMessage;
}

/**
 * Sanitizes document ID from error messages
 * Replaces actual IDs with generic placeholder in production
 *
 * @param id - The document ID
 * @param verboseErrors - Whether to include the actual ID
 * @returns Sanitized ID string
 */
export function sanitizeDocumentId(id: string, verboseErrors = true): string {
  if (verboseErrors) {
    return id;
  }
  return '[document]';
}

/**
 * Creates a sanitized error message for file operations
 * Removes file paths and other sensitive details in production
 *
 * @param operation - The operation being performed (e.g., 'read', 'write')
 * @param error - The original error
 * @param verboseErrors - Whether to include detailed error information
 * @returns Sanitized error message
 */
export function sanitizeFileError(operation: string, error: Error | string, verboseErrors = true): string {
  if (verboseErrors) {
    const message = typeof error === 'string' ? error : error.message;
    return `Failed to ${operation} file: ${message}`;
  }

  return `Failed to ${operation} file`;
}

/**
 * Creates a sanitized error message for storage operations
 * Removes connection strings and other sensitive details in production
 *
 * @param operation - The operation being performed
 * @param error - The original error
 * @param verboseErrors - Whether to include detailed error information
 * @returns Sanitized error message
 */
export function sanitizeStorageError(operation: string, error: Error | string, verboseErrors = true): string {
  if (verboseErrors) {
    const message = typeof error === 'string' ? error : error.message;
    return `Storage ${operation} failed: ${message}`;
  }

  return `Storage operation failed`;
}

/**
 * Generic error messages for common operations
 * Used in production mode to prevent information disclosure
 */
export const GENERIC_ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Validation failed',
  DOCUMENT_NOT_FOUND: 'Document not found',
  DOCUMENT_EXISTS: 'Document already exists',
  DUPLICATE_DOCUMENT: 'Duplicate document detected',
  QUERY_ERROR: 'Query validation failed',
  EMBEDDING_ERROR: 'Embedding generation failed',
  STORAGE_ERROR: 'Storage operation failed',
  NOT_INITIALIZED: 'Database not initialized',
  CONFIGURATION_ERROR: 'Invalid configuration',
} as const;
