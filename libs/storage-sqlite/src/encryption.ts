/**
 * Encryption Layer for SQLite Storage
 *
 * Provides AES-256-GCM encryption for stored values using @frontmcp/utils crypto.
 * Keys are stored in plaintext (needed for lookups); only values are encrypted.
 */

import {
  base64urlDecode,
  base64urlEncode,
  decryptAesGcm,
  encryptAesGcm,
  hkdfSha256,
  randomBytes,
} from '@frontmcp/utils';

/**
 * Thrown when a stored value cannot be decrypted: the encryption secret differs
 * from the one the value was written with, or the value was tampered with.
 */
export class SqliteDecryptionError extends Error {
  readonly code = 'SQLITE_DECRYPTION_FAILED';
  constructor() {
    super(
      'SqliteKvStore: failed to decrypt a stored value. The encryption secret differs from the one the database ' +
        'was written with (or the value is corrupted). Restore the original secret, or delete the database file ' +
        'to start empty.',
    );
    this.name = 'SqliteDecryptionError';
  }
}

const HKDF_SALT = new TextEncoder().encode('frontmcp-sqlite-storage-v1');
const HKDF_INFO = new TextEncoder().encode('aes-256-gcm-value-encryption');
const KEY_LENGTH = 32; // AES-256

/**
 * Derives a 256-bit encryption key from a user-provided secret using HKDF-SHA256.
 *
 * @param secret - User-provided secret key material
 * @returns 32-byte encryption key
 */
export function deriveEncryptionKey(secret: string): Uint8Array {
  const ikm = new TextEncoder().encode(secret);
  return hkdfSha256(ikm, HKDF_SALT, HKDF_INFO, KEY_LENGTH);
}

/**
 * Encrypted value format stored in the database.
 * Format: base64url(iv):base64url(tag):base64url(ciphertext)
 */
const SEPARATOR = ':';

/**
 * Encrypts a plaintext value using AES-256-GCM.
 *
 * @param key - 32-byte encryption key (from deriveEncryptionKey)
 * @param plaintext - The value to encrypt
 * @returns Encrypted string in format: base64url(iv):base64url(tag):base64url(ciphertext)
 */
export function encryptValue(key: Uint8Array, plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce for AES-GCM
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const { ciphertext, tag } = encryptAesGcm(key, plaintextBytes, iv);

  return [base64urlEncode(iv), base64urlEncode(tag), base64urlEncode(ciphertext)].join(SEPARATOR);
}

/**
 * Decrypts an encrypted value using AES-256-GCM.
 *
 * @param key - 32-byte encryption key (from deriveEncryptionKey)
 * @param encrypted - Encrypted string from encryptValue
 * @returns Decrypted plaintext string
 * @throws Error if the value is tampered with or the key is wrong
 */
export function decryptValue(key: Uint8Array, encrypted: string): string {
  const parts = encrypted.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }

  const iv = base64urlDecode(parts[0]);
  const tag = base64urlDecode(parts[1]);
  const ciphertext = base64urlDecode(parts[2]);

  try {
    return new TextDecoder().decode(decryptAesGcm(key, ciphertext, iv, tag));
  } catch {
    throw new SqliteDecryptionError();
  }
}
