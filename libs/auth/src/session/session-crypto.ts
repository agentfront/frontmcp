/**
 * Session Cryptographic Utilities
 *
 * Provides AES-256-GCM encryption/decryption and HKDF key derivation
 * for session management. Uses @frontmcp/utils for cross-platform crypto.
 */

import {
  encryptAesGcm as rawEncrypt,
  decryptAesGcm as rawDecrypt,
  hkdfSha256 as rawHkdf,
  randomBytes,
  base64urlEncode,
  base64urlDecode,
} from '@frontmcp/utils';

/**
 * AES-256-GCM encrypted blob with base64url-encoded fields.
 * Simpler than EncBlob from TokenVault (no kid, exp, meta).
 */
export type SessionEncBlob = {
  alg: 'A256GCM';
  iv: string; // base64url
  tag: string; // base64url
  data: string; // base64url
};

/**
 * Encrypt UTF-8 text using AES-256-GCM.
 * Auto-generates a 12-byte IV.
 *
 * @param key - 32-byte encryption key (Uint8Array or Buffer)
 * @param plaintext - UTF-8 text to encrypt
 * @returns Encrypted blob with base64url-encoded fields
 */
export async function encryptAesGcm(key: Uint8Array, plaintext: string): Promise<SessionEncBlob> {
  const iv = randomBytes(12);
  const { ciphertext, tag } = await rawEncrypt(key, new TextEncoder().encode(plaintext), iv);

  return {
    alg: 'A256GCM',
    iv: base64urlEncode(iv),
    tag: base64urlEncode(tag),
    data: base64urlEncode(ciphertext),
  };
}

/**
 * Decrypt an AES-256-GCM blob to UTF-8 text.
 *
 * @param key - 32-byte encryption key (Uint8Array or Buffer)
 * @param blob - Encrypted blob with base64url-encoded fields
 * @returns Decrypted UTF-8 text
 */
export async function decryptAesGcm(key: Uint8Array, blob: SessionEncBlob): Promise<string> {
  const iv = base64urlDecode(blob.iv);
  const tag = base64urlDecode(blob.tag);
  const data = base64urlDecode(blob.data);

  const plaintext = await rawDecrypt(key, data, iv, tag);
  return new TextDecoder().decode(plaintext);
}

/**
 * HKDF-SHA256 key derivation (RFC 5869).
 *
 * @param ikm - Input key material (Uint8Array or Buffer)
 * @param salt - Salt value (Uint8Array or Buffer)
 * @param info - Context/application-specific info (Uint8Array or Buffer)
 * @param length - Output key length in bytes
 * @returns Derived key as Uint8Array
 */
export function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return rawHkdf(ikm, salt, info, length);
}

/**
 * Synchronous encrypt for compatibility with existing sync code.
 * Uses the async version internally but blocks (not recommended for production).
 *
 * @deprecated Use the async encryptAesGcm instead
 */
export function encryptAesGcmSync(key: Uint8Array, plaintext: string): SessionEncBlob {
  const iv = randomBytes(12);

  // Use the raw encrypt synchronously (works in Node.js)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: 'A256GCM',
    iv: base64urlEncode(iv),
    tag: base64urlEncode(tag),
    data: base64urlEncode(encrypted),
  };
}

/**
 * Synchronous decrypt for compatibility with existing sync code.
 *
 * @deprecated Use the async decryptAesGcm instead
 */
export function decryptAesGcmSync(key: Uint8Array, blob: SessionEncBlob): string {
  const iv = base64urlDecode(blob.iv);
  const tag = base64urlDecode(blob.tag);
  const data = base64urlDecode(blob.data);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  return decrypted.toString('utf8');
}
