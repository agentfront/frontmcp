/**
 * VectoriaDB Error Classes
 * Production-ready error handling with specific error types
 */

/**
 * Base error class for all VectoriaDB errors
 */
export class VectoriaError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Thrown when attempting operations before VectoriaDB is initialized
 */
export class VectoriaNotInitializedError extends VectoriaError {
  constructor(operation: string) {
    super(`VectoriaDB must be initialized before ${operation}. Call initialize() first.`, 'NOT_INITIALIZED');
  }
}

/**
 * Thrown when document validation fails
 */
export class DocumentValidationError extends VectoriaError {
  constructor(message: string, public readonly documentId?: string) {
    super(message, 'DOCUMENT_VALIDATION_ERROR');
  }
}

/**
 * Thrown when a document with the given ID is not found
 */
export class DocumentNotFoundError extends VectoriaError {
  constructor(public readonly documentId: string) {
    super(`Document with id "${documentId}" not found`, 'DOCUMENT_NOT_FOUND');
  }
}

/**
 * Thrown when attempting to add a document that already exists
 */
export class DocumentExistsError extends VectoriaError {
  constructor(public readonly documentId: string) {
    super(
      `Document with id "${documentId}" already exists. Use remove() first or choose a different id.`,
      'DOCUMENT_EXISTS',
    );
  }
}

/**
 * Thrown when a duplicate document ID is found in a batch operation
 */
export class DuplicateDocumentError extends VectoriaError {
  constructor(public readonly documentId: string, public readonly context: 'batch' | 'existing') {
    const message =
      context === 'batch'
        ? `Duplicate document id "${documentId}" in batch`
        : `Document with id "${documentId}" already exists`;
    super(message, 'DUPLICATE_DOCUMENT');
  }
}

/**
 * Thrown when search query validation fails
 */
export class QueryValidationError extends VectoriaError {
  constructor(message: string) {
    super(message, 'QUERY_VALIDATION_ERROR');
  }
}

/**
 * Thrown when embedding generation fails or produces unexpected results
 */
export class EmbeddingError extends VectoriaError {
  constructor(message: string, public readonly details?: any) {
    super(message, 'EMBEDDING_ERROR');
  }
}

/**
 * Thrown when storage operations fail
 */
export class StorageError extends VectoriaError {
  constructor(message: string, public readonly originalError?: Error) {
    super(message, 'STORAGE_ERROR');
  }
}

/**
 * Thrown when configuration is invalid
 */
export class ConfigurationError extends VectoriaError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
  }
}
