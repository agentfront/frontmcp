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

/** Alias for conditional import resolution via `#crypto-provider`. */
export { browserCrypto as cryptoProvider };

// ═══════════════════════════════════════════════════════════════════
// RSA VERIFICATION (Browser-compatible via WebCrypto)
// ═══════════════════════════════════════════════════════════════════

import { isRsaPssAlg, jwtAlgToWebCryptoAlg } from './jwt-alg';
export { isRsaPssAlg, jwtAlgToWebCryptoAlg } from './jwt-alg';

/**
 * Verify an RSA signature using WebCrypto.
 *
 * Supports RS256/RS384/RS512 (RSASSA-PKCS1-v1_5) and PS256/PS384/PS512 (RSA-PSS).
 * Works in both browsers and Node.js environments that provide `crypto.subtle`.
 *
 * @param jwtAlg - JWT algorithm identifier (e.g. 'RS256', 'PS256')
 * @param data - The signed data (e.g. `headerB64.payloadB64`)
 * @param publicJwk - Public key in JWK format
 * @param signature - The signature bytes
 * @returns true if the signature is valid
 */
export async function rsaVerifyBrowser(
  jwtAlg: string,
  data: Uint8Array,
  publicJwk: JsonWebKey,
  signature: Uint8Array,
): Promise<boolean> {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error('WebCrypto API (crypto.subtle) is not available in this environment');
  }

  const webAlg = jwtAlgToWebCryptoAlg(jwtAlg);
  const isPss = isRsaPssAlg(jwtAlg);

  const algorithm: RsaHashedImportParams = {
    name: isPss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5',
    hash: { name: webAlg },
  };

  const key = await globalThis.crypto.subtle.importKey('jwk', publicJwk, algorithm, false, ['verify']);

  const verifyAlgorithm: AlgorithmIdentifier | RsaPssParams = isPss
    ? { name: 'RSA-PSS', saltLength: getSaltLength(jwtAlg) }
    : { name: 'RSASSA-PKCS1-v1_5' };

  // Create new Uint8Array views to ensure standard ArrayBuffer backing
  const sigBuf = new Uint8Array(signature).buffer as ArrayBuffer;
  const dataBuf = new Uint8Array(data).buffer as ArrayBuffer;
  return globalThis.crypto.subtle.verify(verifyAlgorithm, key, sigBuf, dataBuf);
}

/**
 * Get the salt length for RSA-PSS based on the JWT algorithm.
 */
function getSaltLength(jwtAlg: string): number {
  switch (jwtAlg) {
    case 'PS256':
      return 32; // SHA-256 digest length
    case 'PS384':
      return 48; // SHA-384 digest length
    case 'PS512':
      return 64; // SHA-512 digest length
    default:
      return 32;
  }
}
