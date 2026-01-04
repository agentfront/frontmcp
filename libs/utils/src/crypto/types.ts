/**
 * Crypto Provider Types
 *
 * Defines the interface for cryptographic operations that work across
 * Node.js and browser environments.
 */

/**
 * Encrypted blob structure for AES-256-GCM encryption.
 * All fields are base64url encoded.
 */
export interface EncBlob {
  alg: 'A256GCM';
  iv: string;
  tag: string;
  data: string;
}

/**
 * Crypto provider interface for cross-platform cryptographic operations.
 * All operations are synchronous for consistency across platforms.
 */
export interface CryptoProvider {
  /**
   * Generate a UUID v4 string.
   */
  randomUUID(): string;

  /**
   * Generate cryptographically secure random bytes.
   */
  randomBytes(length: number): Uint8Array;

  /**
   * Compute SHA-256 hash.
   */
  sha256(data: string | Uint8Array): Uint8Array;

  /**
   * Compute SHA-256 hash and return as hex string.
   */
  sha256Hex(data: string | Uint8Array): string;

  /**
   * Compute HMAC-SHA256.
   */
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;

  /**
   * HKDF-SHA256 key derivation (RFC 5869).
   */
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;

  /**
   * Encrypt using AES-256-GCM.
   */
  encryptAesGcm(key: Uint8Array, plaintext: Uint8Array, iv: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array };

  /**
   * Decrypt using AES-256-GCM.
   */
  decryptAesGcm(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array, tag: Uint8Array): Uint8Array;

  /**
   * Constant-time comparison to prevent timing attacks.
   */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
