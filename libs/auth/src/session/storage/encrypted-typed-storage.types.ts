/**
 * EncryptedTypedStorage Types
 *
 * Type definitions for the EncryptedTypedStorage wrapper that provides
 * transparent encryption/decryption with key rotation support.
 */

import type { SetOptions } from '@frontmcp/utils';
import type { z } from 'zod';

/**
 * Encryption key with identifier for key rotation support.
 */
export interface EncryptionKey {
  /**
   * Unique key identifier.
   * Used to identify which key was used to encrypt a value.
   */
  kid: string;

  /**
   * 32-byte (256-bit) AES key.
   */
  key: Uint8Array;
}

/**
 * Client-side key binding configuration for SOC2/ISO compliance.
 *
 * When provided, the actual encryption key is derived from BOTH
 * the server key AND a client-provided secret using HKDF-SHA256.
 *
 * Security properties:
 * - Server cannot decrypt without client secret (e.g., sessionId)
 * - Client cannot decrypt without server key
 * - Prevents RCE attacks from stealing user data
 * - Deterministic derivation (same inputs → same key)
 *
 * @example
 * ```typescript
 * const storage = new EncryptedTypedStorage(adapter, {
 *   keys: [{ kid: 'server-2024', key: serverKey }],
 *   clientBinding: {
 *     secret: sessionId,  // From MCP client
 *     info: 'user-secrets-v1'
 *   }
 * });
 * ```
 */
export interface ClientKeyBinding {
  /**
   * Client-provided secret (e.g., sessionId, token hash).
   * This MUST be provided by the MCP client for every operation.
   *
   * Can be provided as a string (will be UTF-8 encoded) or raw bytes.
   */
  secret: Uint8Array | string;

  /**
   * Optional salt for HKDF derivation.
   * If not provided, uses empty salt (per RFC 5869).
   */
  salt?: Uint8Array;

  /**
   * Domain separation info for HKDF.
   * Different values produce different keys even with same inputs.
   * Use to separate keys for different purposes (e.g., 'vault', 'tokens').
   * @default 'frontmcp-client-bound-v1'
   */
  info?: string;
}

/**
 * Options for EncryptedTypedStorage wrapper.
 */
export interface EncryptedTypedStorageOptions<T> {
  /**
   * Encryption keys for the storage.
   * First key is the "active" key used for new encryptions.
   * All keys are tried for decryption (supports key rotation).
   *
   * Must have at least one key.
   */
  keys: EncryptionKey[];

  /**
   * Optional Zod schema for validation after decryption.
   * If provided, values will be validated after decryption.
   */
  schema?: z.ZodType<T>;

  /**
   * Whether to throw an error when data fails validation or decryption.
   * If false (default), returns null for invalid/undecryptable data.
   * @default false
   */
  throwOnError?: boolean;

  /**
   * Optional callback when a value is decrypted with a non-active key.
   * Useful for implementing transparent re-encryption during reads.
   */
  onKeyRotationNeeded?: (key: string, oldKid: string, newKid: string) => void;

  /**
   * Optional client-side key binding for SOC2/ISO compliance.
   *
   * When provided, the actual encryption key is derived from BOTH
   * the server key AND this client secret using HKDF-SHA256 (RFC 5869).
   *
   * Security implications:
   * - Without the client secret, data CANNOT be decrypted even
   *   if the server key is compromised
   * - Prevents RCE attacks from stealing user data
   * - Each session can only access its own encrypted data
   *
   * Omit for debugging/development to use server key directly.
   */
  clientBinding?: ClientKeyBinding;
}

/**
 * Options for encrypted set operations.
 * Re-export for convenience.
 */
export type EncryptedSetOptions = SetOptions;

/**
 * Entry for batch set operations with encrypted values.
 */
export interface EncryptedSetEntry<T> {
  key: string;
  value: T;
  options?: EncryptedSetOptions;
}

/**
 * Encrypted blob stored in the underlying storage.
 * Includes key ID for identifying which key was used.
 */
export interface StoredEncryptedBlob {
  /** Algorithm used (always A256GCM) */
  alg: 'A256GCM';
  /** Key ID used for encryption */
  kid: string;
  /** Base64url-encoded initialization vector */
  iv: string;
  /** Base64url-encoded authentication tag */
  tag: string;
  /** Base64url-encoded ciphertext */
  data: string;
}
