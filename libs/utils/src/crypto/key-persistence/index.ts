/**
 * KeyPersistence Module
 *
 * Unified key persistence for browser and Node.js environments.
 * Uses StorageAdapter abstraction to support both memory (browser)
 * and filesystem (Node.js) backends.
 *
 * @example
 * ```typescript
 * import { createKeyPersistence } from '@frontmcp/utils';
 *
 * // Auto-detect storage (filesystem in Node.js, memory in browser)
 * const keys = await createKeyPersistence();
 *
 * // Get or create a secret
 * const secret = await keys.getOrCreateSecret('encryption-key');
 * console.log(secret.secret); // base64url-encoded secret
 *
 * // Store a custom key
 * await keys.set({
 *   type: 'secret',
 *   kid: 'my-key',
 *   secret: 'abc...',
 *   bytes: 32,
 *   createdAt: Date.now(),
 *   version: 1,
 * });
 * ```
 *
 * @module @frontmcp/utils/key-persistence
 */

// Types
export type {
  BaseKeyData,
  SecretKeyData,
  AsymmetricKeyData,
  AnyKeyData,
  KeyPersistenceOptions,
  CreateKeyPersistenceOptions,
  CreateSecretOptions,
  CreateAsymmetricOptions,
} from './types';

// Schemas and validation
export {
  asymmetricAlgSchema,
  secretKeyDataSchema,
  asymmetricKeyDataSchema,
  anyKeyDataSchema,
  validateKeyData,
  parseKeyData,
  isSecretKeyData,
  isAsymmetricKeyData,
  type KeyValidationResult,
} from './schemas';

// Main class
export { KeyPersistence } from './key-persistence';

// Factory functions
export { createKeyPersistence, createKeyPersistenceWithStorage } from './factory';
