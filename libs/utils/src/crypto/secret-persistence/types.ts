/**
 * Types for secret persistence utilities.
 *
 * @module @frontmcp/utils/secret-persistence
 */

/**
 * Data structure for a persisted secret.
 */
export interface SecretData {
  /** Random secret, base64url encoded (typically 32 bytes = 256 bits) */
  secret: string;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Version for future migrations */
  version: number;
}

/**
 * Options for secret persistence operations.
 */
export interface SecretPersistenceOptions {
  /**
   * Path to store the secret file.
   * If relative, resolved from current working directory.
   * @default '.frontmcp/<name>-secret.json'
   */
  secretPath?: string;

  /**
   * Secret name used in default path and log messages.
   * @default 'default'
   */
  name?: string;

  /**
   * Enable persistence in production (NOT RECOMMENDED for multi-server).
   * In production, use environment variables instead.
   * @default false
   */
  forceEnable?: boolean;

  /**
   * Number of bytes to generate for new secrets.
   * @default 32 (256 bits)
   */
  secretBytes?: number;

  /**
   * Enable logging of persistence operations.
   * @default true
   */
  enableLogging?: boolean;

  /**
   * Custom logger for persistence messages.
   * Defaults to console.warn/console.error.
   */
  logger?: {
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

/**
 * Result of validating secret data.
 */
export interface SecretValidationResult {
  /** Whether the secret data is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}
