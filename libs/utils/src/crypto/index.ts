/**
 * Cross-Platform Crypto Module
 *
 * Provides cryptographic operations that work in both Node.js and browser environments.
 * Uses native crypto in Node.js and @noble/hashes + @noble/ciphers in browsers.
 */

import { isNode } from './runtime';
import type { CryptoProvider, EncBlob } from './types';
export { isRsaPssAlg, jwtAlgToNodeAlg } from './jwt-alg';

// Lazy-loaded provider
let _provider: CryptoProvider | null = null;

/**
 * Get the crypto provider for the current runtime environment.
 * Lazily initializes the provider.
 *
 * Note: this module intentionally avoids importing any Node-only crypto modules
 * at module-load time so it can be used in browser builds without pulling them in.
 */
export function getCrypto(): CryptoProvider {
  if (!_provider) {
    if (isNode()) {
      // Node.js: keep crypto module isolated from browser builds
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _provider = require('./node').nodeCrypto as CryptoProvider;
    } else {
      // Browser: noble-based implementation
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _provider = require('./browser').browserCrypto as CryptoProvider;
    }
  }
  return _provider!;
}

// Convenience function exports - delegate to provider

/**
 * Generate a UUID v4 string.
 */
export function randomUUID(): string {
  return getCrypto().randomUUID();
}

/**
 * Generate cryptographically secure random bytes.
 * @param length - Number of bytes to generate (must be a positive integer)
 * @throws Error if length is not a positive integer
 */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`randomBytes length must be a positive integer, got ${length}`);
  }
  return getCrypto().randomBytes(length);
}

/**
 * Compute SHA-256 hash.
 */
export function sha256(data: string | Uint8Array): Uint8Array {
  return getCrypto().sha256(data);
}

/**
 * Compute SHA-256 hash and return as hex string.
 */
export function sha256Hex(data: string | Uint8Array): string {
  return getCrypto().sha256Hex(data);
}

/**
 * Compute HMAC-SHA256.
 */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return getCrypto().hmacSha256(key, data);
}

// HKDF-SHA256 maximum output length: 255 * hash_length (255 * 32 = 8160 bytes)
const HKDF_SHA256_MAX_LENGTH = 255 * 32;

/**
 * HKDF-SHA256 key derivation (RFC 5869).
 * @param ikm - Input keying material
 * @param salt - Salt value (can be empty)
 * @param info - Context and application specific information
 * @param length - Length of output keying material in bytes (1 to 8160)
 * @throws Error if length is not a positive integer or exceeds HKDF limits
 */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error(`HKDF length must be a positive integer, got ${length}`);
  }
  if (length > HKDF_SHA256_MAX_LENGTH) {
    throw new Error(`HKDF-SHA256 length cannot exceed ${HKDF_SHA256_MAX_LENGTH} bytes, got ${length}`);
  }
  return getCrypto().hkdfSha256(ikm, salt, info, length);
}

/**
 * Encrypt using AES-256-GCM.
 * @param key - 32-byte encryption key (AES-256)
 * @param plaintext - Data to encrypt
 * @param iv - 12-byte initialization vector (96 bits, recommended for GCM)
 * @throws Error if key is not 32 bytes or IV is not 12 bytes
 */
export function encryptAesGcm(
  key: Uint8Array,
  plaintext: Uint8Array,
  iv: Uint8Array,
): { ciphertext: Uint8Array; tag: Uint8Array } {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM requires a 32-byte key, got ${key.length} bytes`);
  }
  if (iv.length !== 12) {
    throw new Error(`AES-GCM requires a 12-byte IV, got ${iv.length} bytes`);
  }
  return getCrypto().encryptAesGcm(key, plaintext, iv);
}

/**
 * Decrypt using AES-256-GCM.
 * @param key - 32-byte encryption key (AES-256)
 * @param ciphertext - Encrypted data
 * @param iv - 12-byte initialization vector (96 bits)
 * @param tag - 16-byte authentication tag
 * @throws Error if key is not 32 bytes, IV is not 12 bytes, or tag is not 16 bytes
 */
export function decryptAesGcm(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array, tag: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error(`AES-256-GCM requires a 32-byte key, got ${key.length} bytes`);
  }
  if (iv.length !== 12) {
    throw new Error(`AES-GCM requires a 12-byte IV, got ${iv.length} bytes`);
  }
  if (tag.length !== 16) {
    throw new Error(`AES-GCM requires a 16-byte authentication tag, got ${tag.length} bytes`);
  }
  return getCrypto().decryptAesGcm(key, ciphertext, iv, tag);
}

/**
 * Constant-time comparison to prevent timing attacks.
 * @param a - First byte array to compare
 * @param b - Second byte array to compare
 * @throws Error if arrays have different lengths
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    throw new Error(`timingSafeEqual requires equal-length arrays, got ${a.length} and ${b.length} bytes`);
  }
  return getCrypto().timingSafeEqual(a, b);
}

// ============================================
// Encoding Utilities
// ============================================

/**
 * Convert a Uint8Array to hex string.
 */
export function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================
// Base64 URL Encoding Utilities
// ============================================

/**
 * Encode a Uint8Array to base64url string.
 * RFC 4648 Section 5: Base64 with URL and filename safe alphabet.
 */
export function base64urlEncode(data: Uint8Array): string {
  // Convert to regular base64 first
  let base64: string;

  if (typeof Buffer !== 'undefined') {
    // Node.js - use Buffer for efficiency
    base64 = Buffer.from(data).toString('base64');
  } else {
    // Browser - use btoa with Uint8Array
    const binString = Array.from(data, (byte) => String.fromCodePoint(byte)).join('');
    base64 = btoa(binString);
  }

  // Convert to base64url: replace + with -, / with _, and remove padding
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a base64url string to Uint8Array.
 */
export function base64urlDecode(data: string): Uint8Array {
  // Convert base64url to regular base64
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding if needed
  const pad = base64.length % 4;
  if (pad) {
    base64 += '='.repeat(4 - pad);
  }

  if (typeof Buffer !== 'undefined') {
    // Node.js
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } else {
    // Browser
    const binString = atob(base64);
    return Uint8Array.from(binString, (c) => c.codePointAt(0) ?? 0);
  }
}

/**
 * Compute SHA-256 hash and return as base64url string.
 * Commonly used for PKCE code_challenge (S256 method).
 */
export function sha256Base64url(data: string | Uint8Array): string {
  return base64urlEncode(sha256(data));
}

// Re-export types and runtime utilities
export type { CryptoProvider, EncBlob };
export { isNode, isBrowser, assertNode } from './runtime';

// Re-export encrypted blob helpers
export {
  // Types
  type EncryptedBlob,
  // Error class
  EncryptedBlobError,
  // Core functions
  encryptValue,
  decryptValue,
  tryDecryptValue,
  // Serialization
  serializeBlob,
  deserializeBlob,
  tryDeserializeBlob,
  // Validation
  isValidEncryptedBlob,
  // Convenience functions
  encryptAndSerialize,
  deserializeAndDecrypt,
  tryDeserializeAndDecrypt,
} from './encrypted-blob';

// Re-export PKCE utilities (RFC 7636)
export {
  // Constants
  MIN_CODE_VERIFIER_LENGTH,
  MAX_CODE_VERIFIER_LENGTH,
  DEFAULT_CODE_VERIFIER_LENGTH,
  // Error
  PkceError,
  // Functions
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  generatePkcePair,
  isValidCodeVerifier,
  isValidCodeChallenge,
  // Types
  type PkcePair,
} from './pkce';

// Re-export secret persistence utilities
export {
  // Types
  type SecretData,
  type SecretPersistenceOptions,
  type SecretValidationResult,
  // Schema and validation
  secretDataSchema,
  validateSecretData,
  parseSecretData,
  // Persistence operations
  isSecretPersistenceEnabled,
  resolveSecretPath,
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
} from './secret-persistence';
