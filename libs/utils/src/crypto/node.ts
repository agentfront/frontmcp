/**
 * Node.js Crypto Provider
 *
 * Implementation using Node.js native crypto module.
 */

import crypto from 'node:crypto';
import type { CryptoProvider } from './types';
import { isRsaPssAlg, jwtAlgToNodeAlg } from './jwt-alg';
export { isRsaPssAlg, jwtAlgToNodeAlg } from './jwt-alg';

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

// ═══════════════════════════════════════════════════════════════════
// RSA KEY UTILITIES (Node.js only)
// ═══════════════════════════════════════════════════════════════════

/**
 * RSA JWK structure for public keys
 */
export interface RsaJwk {
  kty: 'RSA';
  kid: string;
  alg: string;
  use: 'sig';
  n: string;
  e: string;
}

/**
 * RSA key pair structure
 */
export interface RsaKeyPair {
  /** Private key for signing */
  privateKey: crypto.KeyObject;
  /** Public key for verification */
  publicKey: crypto.KeyObject;
  /** Public key in JWK format */
  publicJwk: RsaJwk;
}

/**
 * Generate an RSA key pair with the specified modulus length
 *
 * @param modulusLength - Key size in bits (default: 2048, suitable for short-lived OAuth/JWT verification; use 3072+ for longer-term keys)
 * @param alg - JWT algorithm (default: 'RS256')
 * @returns RSA key pair with private, public keys and JWK
 */
export function generateRsaKeyPair(modulusLength = 2048, alg = 'RS256'): RsaKeyPair {
  const kid = `rsa-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength,
  });

  const exported = publicKey.export({ format: 'jwk' }) as {
    n: string;
    e: string;
  };
  const publicJwk: RsaJwk = {
    ...exported,
    kid,
    alg,
    use: 'sig',
    kty: 'RSA',
  };

  return { privateKey, publicKey, publicJwk };
}

/**
 * Sign data using RSA with the specified algorithm.
 *
 * For RSA-PSS (PS256/PS384/PS512), callers must pass appropriate padding/saltLength options.
 */
export function rsaSign(
  algorithm: string,
  data: Buffer,
  privateKey: crypto.KeyObject,
  options?: Omit<crypto.SignKeyObjectInput, 'key'>,
): Buffer {
  const signingKey: crypto.KeyObject | crypto.SignKeyObjectInput = options
    ? { key: privateKey, ...options }
    : privateKey;
  return crypto.sign(algorithm, data, signingKey);
}

/**
 * Create a JWT signed with an RSA key
 *
 * @param payload - JWT payload
 * @param privateKey - RSA private key
 * @param kid - Key ID for the JWT header
 * @param alg - JWT algorithm (default: 'RS256')
 * @returns Signed JWT string
 */
export function createSignedJwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid: string,
  alg = 'RS256',
): string {
  const header = { alg, typ: 'JWT', kid };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureInput = `${headerB64}.${payloadB64}`;

  const nodeAlgorithm = jwtAlgToNodeAlg(alg);
  const signature = rsaSign(
    nodeAlgorithm,
    Buffer.from(signatureInput),
    privateKey,
    isRsaPssAlg(alg)
      ? {
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        }
      : undefined,
  );
  const signatureB64 = signature.toString('base64url');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}
