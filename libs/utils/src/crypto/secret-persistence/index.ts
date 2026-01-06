/**
 * Secret persistence utilities for storing encryption secrets.
 *
 * Provides a secure way to persist secrets to disk for development environments.
 * In production, use environment variables instead.
 *
 * @module @frontmcp/utils/secret-persistence
 *
 * @example
 * ```typescript
 * import { getOrCreateSecret } from '@frontmcp/utils';
 *
 * // Get or create a persisted secret
 * const secret = await getOrCreateSecret({
 *   name: 'remember',
 *   secretPath: '.frontmcp/remember-secret.json',
 * });
 *
 * // Use the secret for encryption
 * const key = await deriveKey(secret);
 * ```
 */

// Types
export type { SecretData, SecretPersistenceOptions, SecretValidationResult } from './types';

// Schema and validation
export { secretDataSchema, validateSecretData, parseSecretData } from './schema';

// Persistence operations
export {
  // Environment detection
  isSecretPersistenceEnabled,
  resolveSecretPath,
  // Low-level operations
  loadSecret,
  saveSecret,
  deleteSecret,
  // Secret generation
  generateSecret,
  createSecretData,
  // High-level API
  getOrCreateSecret,
  clearCachedSecret,
  isSecretCached,
} from './persistence';
