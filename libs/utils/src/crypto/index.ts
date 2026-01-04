/**
 * Cross-Platform Crypto Module
 *
 * Provides cryptographic operations that work in both Node.js and browser environments.
 * Uses native crypto in Node.js and @noble/hashes + @noble/ciphers in browsers.
 */

import { isNode } from './runtime';
import type { CryptoProvider, EncBlob } from './types';

// Lazy-loaded provider
let _provider: CryptoProvider | null = null;

/**
 * Get the crypto provider for the current runtime environment.
 * Lazily initializes the appropriate provider (Node.js or browser).
 */
export function getCrypto(): CryptoProvider {
  if (!_provider) {
    if (isNode()) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _provider = require('./node').nodeCrypto as CryptoProvider;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _provider = require('./browser').browserCrypto as CryptoProvider;
    }
  }
  // Provider is always initialized in the if block above
  if (!_provider) {
    throw new Error('Failed to initialize crypto provider');
  }
  return _provider;
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
 */
export function randomBytes(length: number): Uint8Array {
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

/**
 * HKDF-SHA256 key derivation (RFC 5869).
 */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
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
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
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
