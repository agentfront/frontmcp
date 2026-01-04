/**
 * Node.js Crypto Provider
 *
 * Implementation using Node.js native crypto module.
 */

import crypto from 'node:crypto';
import type { CryptoProvider } from './types';

/**
 * Convert Node.js Buffer to Uint8Array.
 */
function toUint8Array(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Normalize input to Buffer for Node.js crypto operations.
 */
function toBuffer(data: string | Uint8Array): Buffer {
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  return Buffer.from(data);
}

/**
 * Node.js crypto provider implementation.
 */
export const nodeCrypto: CryptoProvider = {
  randomUUID(): string {
    return crypto.randomUUID();
  },

  randomBytes(length: number): Uint8Array {
    return toUint8Array(crypto.randomBytes(length));
  },

  sha256(data: string | Uint8Array): Uint8Array {
    const hash = crypto.createHash('sha256').update(toBuffer(data)).digest();
    return toUint8Array(hash);
  },

  sha256Hex(data: string | Uint8Array): string {
    return crypto.createHash('sha256').update(toBuffer(data)).digest('hex');
  },

  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
    const hmac = crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(data)).digest();
    return toUint8Array(hmac);
  },

  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    // Implement HKDF-SHA256 (RFC 5869)
    const ikmBuf = Buffer.from(ikm);
    const saltBuf = salt.length > 0 ? Buffer.from(salt) : Buffer.alloc(32); // Default salt if empty

    // Extract phase: PRK = HMAC-Hash(salt, IKM)
    const prk = crypto.createHmac('sha256', saltBuf).update(ikmBuf).digest();

    // Expand phase
    const hashLen = 32; // SHA-256 output length
    const n = Math.ceil(length / hashLen);
    const chunks: Buffer[] = [];
    let prev: Buffer = Buffer.alloc(0);

    for (let i = 1; i <= n; i++) {
      prev = crypto
        .createHmac('sha256', prk)
        .update(Buffer.concat([prev, Buffer.from(info), Buffer.from([i])]))
        .digest();
      chunks.push(prev);
    }

    return toUint8Array(Buffer.concat(chunks).subarray(0, length));
  },

  encryptAesGcm(key: Uint8Array, plaintext: Uint8Array, iv: Uint8Array): { ciphertext: Uint8Array; tag: Uint8Array } {
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
    const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: toUint8Array(encrypted),
      tag: toUint8Array(tag),
    };
  },

  decryptAesGcm(key: Uint8Array, ciphertext: Uint8Array, iv: Uint8Array, tag: Uint8Array): Uint8Array {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
    decipher.setAuthTag(Buffer.from(tag));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);

    return toUint8Array(decrypted);
  },

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  },
};
