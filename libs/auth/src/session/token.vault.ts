/**
 * Token Vault
 *
 * Secure token encryption/decryption using AES-256-GCM.
 * Supports key rotation for seamless key management.
 */

import { encryptAesGcm, decryptAesGcm, randomBytes, base64urlEncode, base64urlDecode } from '@frontmcp/utils';

export type EncBlob = {
  alg: 'A256GCM';
  kid: string; // master key id
  iv: string; // base64url
  tag: string; // base64url
  data: string; // base64url
  exp?: number; // optional epoch seconds
  meta?: Record<string, unknown>;
};

export type VaultKey = { kid: string; key: Uint8Array };

export class TokenVault {
  /** Active key used for new encryptions */
  private active: VaultKey;
  /** All known keys by kid for decryption (includes active) */
  private keys = new Map<string, Uint8Array>();

  constructor(keys: VaultKey[]) {
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error('TokenVault requires at least one key');
    }

    // Validate all keys before storing
    for (const k of keys) {
      // Validate key is a 32-byte Uint8Array (required for AES-256-GCM)
      if (!(k.key instanceof Uint8Array) || k.key.length !== 32) {
        throw new Error(`TokenVault key "${k.kid}" must be a 32-byte Uint8Array for AES-256-GCM`);
      }

      // Check for duplicate kid values
      if (this.keys.has(k.kid)) {
        throw new Error(`TokenVault duplicate kid: "${k.kid}"`);
      }

      this.keys.set(k.kid, k.key);
    }

    // First key is active by convention
    this.active = keys[0];
  }

  rotateTo(k: VaultKey) {
    // Validate key is a 32-byte Uint8Array (required for AES-256-GCM)
    if (!(k.key instanceof Uint8Array) || k.key.length !== 32) {
      throw new Error(`TokenVault key "${k.kid}" must be a 32-byte Uint8Array for AES-256-GCM`);
    }
    this.active = k;
    this.keys.set(k.kid, k.key);
  }

  async encrypt(plaintext: string, opts?: { exp?: number; meta?: Record<string, unknown> }): Promise<EncBlob> {
    const iv = randomBytes(12);
    const { ciphertext, tag } = await encryptAesGcm(this.active.key, new TextEncoder().encode(plaintext), iv);

    return {
      alg: 'A256GCM',
      kid: this.active.kid,
      iv: base64urlEncode(iv),
      tag: base64urlEncode(tag),
      data: base64urlEncode(ciphertext),
      exp: opts?.exp,
      meta: opts?.meta,
    };
  }

  async decrypt(blob: EncBlob): Promise<string> {
    // Check expiration first (exp is epoch seconds, undefined means non-expiring)
    if (blob.exp !== undefined) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds > blob.exp) {
        throw new Error(`vault_expired:${blob.kid}`);
      }
    }

    const key = this.keys.get(blob.kid);
    if (!key) throw new Error(`vault_unknown_kid:${blob.kid}`);

    const iv = base64urlDecode(blob.iv);
    const tag = base64urlDecode(blob.tag);
    const data = base64urlDecode(blob.data);

    const plaintext = await decryptAesGcm(key, data, iv, tag);
    return new TextDecoder().decode(plaintext);
  }
}
