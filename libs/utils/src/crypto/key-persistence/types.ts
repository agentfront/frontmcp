/**
 * Types for unified key persistence.
 *
 * Supports both symmetric secrets and asymmetric key pairs
 * with a unified storage interface.
 *
 * @module @frontmcp/utils/key-persistence
 */

import type { StorageAdapter } from '../../storage/types';

/**
 * Base interface for all key data types.
 */
export interface BaseKeyData {
  /** Unique key identifier */
  kid: string;
  /** Creation timestamp (ms since epoch) */
  createdAt: number;
  /** Schema version for migrations */
  version: number;
}

/**
 * Symmetric secret key data.
 * Used for encryption, HMAC, and other symmetric operations.
 */
export interface SecretKeyData extends BaseKeyData {
  type: 'secret';
  /** Base64url-encoded secret bytes */
  secret: string;
  /** Number of bytes in the secret */
  bytes: number;
}

/**
 * Asymmetric key pair data (RSA or EC).
 * Used for JWT signing and verification.
 */
export interface AsymmetricKeyData extends BaseKeyData {
  type: 'asymmetric';
  /** Algorithm identifier (RS256, RS384, RS512, ES256, ES384, ES512) */
  alg: 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';
  /** Private key in JWK format */
  privateKey: JsonWebKey;
  /** Public JWKS for verification (contains keys array) */
  publicJwk: { keys: JsonWebKey[] };
}

/**
 * Union of all key types.
 */
export type AnyKeyData = SecretKeyData | AsymmetricKeyData;

/**
 * Options for KeyPersistence constructor.
 */
export interface KeyPersistenceOptions {
  /**
   * Storage adapter for key data.
   * Can be MemoryStorageAdapter, FileSystemStorageAdapter, or any StorageAdapter.
   */
  storage: StorageAdapter;

  /**
   * Whether to throw an error on invalid key data.
   * If false, invalid data is silently ignored (returns null).
   * @default false
   */
  throwOnInvalid?: boolean;

  /**
   * Enable in-memory caching for faster reads.
   * @default true
   */
  enableCache?: boolean;
}

/**
 * Options for creating a KeyPersistence instance.
 */
export interface CreateKeyPersistenceOptions {
  /**
   * Storage type.
   * - 'auto': Auto-detect based on environment (filesystem in Node.js, memory in browser)
   * - 'memory': Always use memory (keys lost on restart)
   * - 'filesystem': Always use filesystem (Node.js only)
   * @default 'auto'
   */
  type?: 'auto' | 'memory' | 'filesystem';

  /**
   * Base directory for filesystem storage.
   * Only used when type is 'filesystem' or 'auto' in Node.js.
   * @default '.frontmcp/keys'
   */
  baseDir?: string;

  /**
   * Whether to throw on invalid key data.
   * @default false
   */
  throwOnInvalid?: boolean;

  /**
   * Enable in-memory caching.
   * @default true
   */
  enableCache?: boolean;
}

/**
 * Options for creating a secret key.
 */
export interface CreateSecretOptions {
  /**
   * Number of bytes to generate.
   * @default 32 (256 bits)
   */
  bytes?: number;
}

/**
 * Options for creating an asymmetric key.
 */
export interface CreateAsymmetricOptions {
  /**
   * Algorithm to use.
   * @default 'RS256'
   */
  alg?: AsymmetricKeyData['alg'];
}
