/**
 * Browser Crypto Provider
 *
 * Implementation using @noble/hashes and @noble/ciphers for cross-platform support.
 * These libraries work in both Node.js and browsers.
 */

import { sha256 as sha256Hash } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils.js';
import { gcm } from '@noble/ciphers/aes.js';
import type { CryptoProvider } from './types';

/**
 * Convert string to Uint8Array using TextEncoder.
 */
function toBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  return data;
}

/**
 * Convert Uint8Array to hex string.
 */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate UUID v4 from random bytes.
 * Uses crypto.randomUUID() if available, otherwise generates from random bytes.
 */
function generateUUID(): string {
  // Prefer native crypto.randomUUID if available (modern browsers and Node.js 16.7+)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: Generate UUID v4 from random bytes
  const bytes = nobleRandomBytes(16);

  // Set version (4) and variant (RFC4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant RFC4122

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Constant-time comparison to prevent timing attacks.
 * Compares all bytes even if mismatch is found early.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Browser-compatible crypto provider using @noble libraries.
 */
export const browserCrypto: CryptoProvider = {
  randomUUID(): string {
    return generateUUID();
  },

  randomBytes(length: number): Uint8Array {
    return nobleRandomBytes(length);
  },

  sha256(data: string | Uint8Array): Uint8Array {
    return sha256Hash(toBytes(data));
  },

  sha256Hex(data: string | Uint8Array): string {
    return toHex(sha256Hash(toBytes(data)));
  },

  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
    return hmac(sha256Hash, key, data);
  },

  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    // Use @noble/hashes hkdf implementation
    const effectiveSalt = salt.length > 0 ? salt : new Uint8Array(32);
    return hkdf(sha256Hash, ikm, effectiveSalt, info, length);
  },

  encryptAesGcm(key: Uint8Array, plaintext: Uint8Array, iv: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } {
    const cipher = gcm(key, iv);
    const sealed = cipher.encrypt(plaintext);

    // GCM sealed format: ciphertext || tag (last 16 bytes)
    const ciphertext = sealed.slice(0, -16);
    const tag = sealed.slice(-16);

    return { ciphertext, tag };
  },

  decryptAesGcm(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array, tag: Uint8Array): Uint8Array {
    const cipher = gcm(key, iv);

    // Reconstruct sealed format: ciphertext || tag
    const sealed = new Uint8Array(ciphertext.length + tag.length);
    sealed.set(ciphertext);
    sealed.set(tag, ciphertext.length);

    return cipher.decrypt(sealed);
  },

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    return constantTimeEqual(a, b);
  },
};
