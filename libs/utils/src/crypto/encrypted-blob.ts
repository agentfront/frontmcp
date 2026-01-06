/**
 * Encrypted Blob Utilities
 *
 * Higher-level helpers for encrypting/decrypting JSON-serializable data
 * using AES-256-GCM. All operations are synchronous.
 *
 * @module @frontmcp/utils/crypto
 */

import { encryptAesGcm, decryptAesGcm, randomBytes, base64urlEncode, base64urlDecode } from './index';
import type { EncBlob } from './types';

// Re-export EncBlob as EncryptedBlob for clarity
export type EncryptedBlob = EncBlob;

/** Text encoder for string to Uint8Array conversion */
const textEncoder = new TextEncoder();

/** Text decoder for Uint8Array to string conversion */
const textDecoder = new TextDecoder();

/**
 * Error thrown when encrypted blob operations fail.
 */
export class EncryptedBlobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptedBlobError';
  }
}

/**
 * Encrypt a value using AES-256-GCM.
 *
 * @param data - Value to encrypt (will be JSON serialized)
 * @param key - 32-byte encryption key
 * @returns Encrypted blob with base64url-encoded fields
 * @throws EncryptedBlobError if key is invalid or data cannot be serialized
 *
 * @example
 * ```typescript
 * const key = hkdfSha256(ikm, salt, info, 32);
 * const blob = encryptValue({ secret: 'data' }, key);
 * // blob.alg === 'A256GCM'
 * // blob.iv, blob.tag, blob.data are base64url strings
 * ```
 */
export function encryptValue<T>(data: T, key: Uint8Array): EncryptedBlob {
  if (key.length !== 32) {
    throw new EncryptedBlobError(`Encryption key must be 32 bytes (AES-256), got ${key.length} bytes`);
  }

  let jsonString: string;
  try {
    jsonString = JSON.stringify(data);
  } catch (error) {
    throw new EncryptedBlobError(`Failed to serialize data: ${(error as Error).message}`);
  }

  const plaintext = textEncoder.encode(jsonString);
  const iv = randomBytes(12);

  const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);

  return {
    alg: 'A256GCM',
    iv: base64urlEncode(iv),
    tag: base64urlEncode(tag),
    data: base64urlEncode(ciphertext),
  };
}

/**
 * Decrypt an encrypted blob and parse the JSON result.
 *
 * @param blob - Encrypted blob to decrypt
 * @param key - 32-byte encryption key (must match encryption key)
 * @returns Decrypted and parsed value
 * @throws EncryptedBlobError if decryption or parsing fails
 *
 * @example
 * ```typescript
 * const decrypted = decryptValue<MyType>(blob, key);
 * ```
 */
export function decryptValue<T>(blob: EncryptedBlob, key: Uint8Array): T {
  if (key.length !== 32) {
    throw new EncryptedBlobError(`Decryption key must be 32 bytes (AES-256), got ${key.length} bytes`);
  }

  if (blob.alg !== 'A256GCM') {
    throw new EncryptedBlobError(`Unsupported algorithm: ${blob.alg}, expected A256GCM`);
  }

  let iv: Uint8Array;
  let tag: Uint8Array;
  let ciphertext: Uint8Array;

  try {
    iv = base64urlDecode(blob.iv);
    tag = base64urlDecode(blob.tag);
    ciphertext = base64urlDecode(blob.data);
  } catch (error) {
    throw new EncryptedBlobError(`Failed to decode blob fields: ${(error as Error).message}`);
  }

  let decrypted: Uint8Array;
  try {
    decrypted = decryptAesGcm(key, ciphertext, iv, tag);
  } catch (error) {
    throw new EncryptedBlobError(`Decryption failed: ${(error as Error).message}`);
  }

  try {
    return JSON.parse(textDecoder.decode(decrypted)) as T;
  } catch (error) {
    throw new EncryptedBlobError(`Failed to parse decrypted data: ${(error as Error).message}`);
  }
}

/**
 * Try to decrypt an encrypted blob, returning null on failure.
 *
 * @param blob - Encrypted blob to decrypt
 * @param key - 32-byte encryption key
 * @returns Decrypted value or null if decryption/parsing fails
 *
 * @example
 * ```typescript
 * const result = tryDecryptValue<MyType>(blob, key);
 * if (result !== null) {
 *   // Use decrypted data
 * }
 * ```
 */
export function tryDecryptValue<T>(blob: EncryptedBlob, key: Uint8Array): T | null {
  try {
    return decryptValue<T>(blob, key);
  } catch {
    return null;
  }
}

/**
 * Serialize an encrypted blob to a JSON string for storage.
 *
 * @param blob - Encrypted blob to serialize
 * @returns JSON string representation
 *
 * @example
 * ```typescript
 * const blob = encryptValue(data, key);
 * const str = serializeBlob(blob);
 * // Store str in database/redis/etc.
 * ```
 */
export function serializeBlob(blob: EncryptedBlob): string {
  return JSON.stringify(blob);
}

/**
 * Deserialize a JSON string back to an encrypted blob.
 *
 * @param str - JSON string to deserialize
 * @returns Encrypted blob
 * @throws EncryptedBlobError if string is not a valid encrypted blob
 *
 * @example
 * ```typescript
 * const blob = deserializeBlob(storedString);
 * const data = decryptValue(blob, key);
 * ```
 */
export function deserializeBlob(str: string): EncryptedBlob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(str);
  } catch (error) {
    throw new EncryptedBlobError(`Failed to parse blob JSON: ${(error as Error).message}`);
  }

  if (!isValidEncryptedBlob(parsed)) {
    throw new EncryptedBlobError('Invalid encrypted blob structure');
  }

  return parsed;
}

/**
 * Try to deserialize a JSON string to an encrypted blob, returning null on failure.
 *
 * @param str - JSON string to deserialize
 * @returns Encrypted blob or null if invalid
 *
 * @example
 * ```typescript
 * const blob = tryDeserializeBlob(storedString);
 * if (blob !== null) {
 *   const data = tryDecryptValue(blob, key);
 * }
 * ```
 */
export function tryDeserializeBlob(str: string): EncryptedBlob | null {
  try {
    return deserializeBlob(str);
  } catch {
    return null;
  }
}

/**
 * Check if a value is a valid encrypted blob structure.
 *
 * @param value - Value to check
 * @returns true if value is a valid EncryptedBlob
 */
export function isValidEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === 'object' &&
    value !== null &&
    'alg' in value &&
    'iv' in value &&
    'tag' in value &&
    'data' in value &&
    (value as EncryptedBlob).alg === 'A256GCM' &&
    typeof (value as EncryptedBlob).iv === 'string' &&
    typeof (value as EncryptedBlob).tag === 'string' &&
    typeof (value as EncryptedBlob).data === 'string'
  );
}

/**
 * Encrypt and serialize in one step.
 *
 * @param data - Value to encrypt
 * @param key - 32-byte encryption key
 * @returns JSON string of encrypted blob
 *
 * @example
 * ```typescript
 * const encrypted = encryptAndSerialize({ secret: 'data' }, key);
 * // Store encrypted string
 * ```
 */
export function encryptAndSerialize<T>(data: T, key: Uint8Array): string {
  const blob = encryptValue(data, key);
  return serializeBlob(blob);
}

/**
 * Deserialize and decrypt in one step.
 *
 * @param str - JSON string of encrypted blob
 * @param key - 32-byte encryption key
 * @returns Decrypted and parsed value
 * @throws EncryptedBlobError if deserialization or decryption fails
 *
 * @example
 * ```typescript
 * const data = deserializeAndDecrypt<MyType>(storedString, key);
 * ```
 */
export function deserializeAndDecrypt<T>(str: string, key: Uint8Array): T {
  const blob = deserializeBlob(str);
  return decryptValue<T>(blob, key);
}

/**
 * Try to deserialize and decrypt, returning null on any failure.
 *
 * @param str - JSON string of encrypted blob
 * @param key - 32-byte encryption key
 * @returns Decrypted value or null if any step fails
 *
 * @example
 * ```typescript
 * const data = tryDeserializeAndDecrypt<MyType>(storedString, key);
 * if (data !== null) {
 *   // Use decrypted data
 * }
 * ```
 */
export function tryDeserializeAndDecrypt<T>(str: string, key: Uint8Array): T | null {
  try {
    return deserializeAndDecrypt<T>(str, key);
  } catch {
    return null;
  }
}
