/**
 * Storage Error Classes
 *
 * Custom error types for storage operations.
 * All errors extend StorageError for easy catching.
 */

/**
 * Base error class for all storage-related errors.
 */
export class StorageError extends Error {
  public override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.cause = cause;
    this.name = 'StorageError';

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace if available
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when storage connection fails.
 *
 * @example
 * ```typescript
 * throw new StorageConnectionError(
 *   'Failed to connect to Redis',
 *   originalError
 * );
 * ```
 */
export class StorageConnectionError extends StorageError {
  constructor(message: string, cause?: Error, public readonly backend?: string) {
    super(message, cause);
    this.name = 'StorageConnectionError';
  }
}

/**
 * Error thrown when a storage operation fails.
 *
 * @example
 * ```typescript
 * throw new StorageOperationError(
 *   'set',
 *   'user:123',
 *   'Value too large',
 *   originalError
 * );
 * ```
 */
export class StorageOperationError extends StorageError {
  constructor(public readonly operation: string, public readonly key: string, message: string, cause?: Error) {
    super(`${operation} failed for key "${key}": ${message}`, cause);
    this.name = 'StorageOperationError';
  }
}

/**
 * Error thrown when a feature is not supported by the adapter.
 *
 * @example
 * ```typescript
 * throw new StorageNotSupportedError(
 *   'publish',
 *   'vercel-kv',
 *   'Vercel KV does not support pub/sub. Use Upstash instead.'
 * );
 * ```
 */
export class StorageNotSupportedError extends StorageError {
  constructor(public readonly operation: string, public readonly backend: string, suggestion?: string) {
    const msg = suggestion
      ? `${operation} is not supported by ${backend}. ${suggestion}`
      : `${operation} is not supported by ${backend}`;
    super(msg);
    this.name = 'StorageNotSupportedError';
  }
}

/**
 * Error thrown when storage configuration is invalid.
 *
 * @example
 * ```typescript
 * throw new StorageConfigError(
 *   'redis',
 *   'Either "client" or "config"/"url" must be provided'
 * );
 * ```
 */
export class StorageConfigError extends StorageError {
  constructor(public readonly backend: string, message: string) {
    super(`Invalid ${backend} configuration: ${message}`);
    this.name = 'StorageConfigError';
  }
}

/**
 * Error thrown when TTL value is invalid.
 *
 * @example
 * ```typescript
 * throw new StorageTTLError(-1, 'TTL must be a positive integer');
 * ```
 */
export class StorageTTLError extends StorageError {
  constructor(public readonly ttl: unknown, message?: string) {
    super(message ?? `Invalid TTL value: ${ttl}. TTL must be a positive integer.`);
    this.name = 'StorageTTLError';
  }
}

/**
 * Error thrown when a key pattern is invalid or potentially dangerous.
 *
 * @example
 * ```typescript
 * throw new StoragePatternError(
 *   pattern,
 *   'Pattern is too complex and may cause ReDoS'
 * );
 * ```
 */
export class StoragePatternError extends StorageError {
  constructor(public readonly pattern: string, message: string) {
    super(`Invalid pattern "${pattern}": ${message}`);
    this.name = 'StoragePatternError';
  }
}

/**
 * Error thrown when storage is not connected.
 *
 * @example
 * ```typescript
 * throw new StorageNotConnectedError('redis');
 * ```
 */
export class StorageNotConnectedError extends StorageError {
  constructor(public readonly backend: string) {
    super(`Storage backend "${backend}" is not connected. Call connect() first.`);
    this.name = 'StorageNotConnectedError';
  }
}
