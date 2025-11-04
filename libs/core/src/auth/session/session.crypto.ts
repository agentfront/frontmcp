// auth/services/session/session.crypto.ts
import crypto from 'node:crypto';
import type { EncBlob } from './session.types';

/** Encrypt UTF-8 text using AES-256-GCM. Returns base64url fields. */
export function encryptAesGcm(key: Buffer, plaintext: string): EncBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    data: data.toString('base64url'),
  };
}

/** Decrypt an AES-256-GCM blob (base64url fields) to UTF-8 text. */
export function decryptAesGcm(key: Buffer, blob: EncBlob): string {
  const iv = Buffer.from(blob.iv, 'base64url');
  const tag = Buffer.from(blob.tag, 'base64url');
  const data = Buffer.from(blob.data, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString('utf8');
}

/** HKDF-SHA256 (RFC 5869) to derive key material. */
export function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  let prev: Buffer = Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let ctr = 1;
  while (Buffer.concat(chunks).length < length) {
    prev = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([prev, info, Buffer.from([ctr++])]))
      .digest();
    chunks.push(prev);
  }
  return Buffer.concat(chunks).subarray(0, length);
}
