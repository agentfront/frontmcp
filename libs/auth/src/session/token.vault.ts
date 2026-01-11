/**
 * Token Vault
 *
 * Secure token encryption/decryption using AES-256-GCM.
 * Supports key rotation for seamless key management.
 */

import { encryptAesGcm, decryptAesGcm, randomBytes } from '@frontmcp/utils';

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
    // first is active by convention
    this.active = keys[0];
    for (const k of keys) this.keys.set(k.kid, k.key);
  }

  rotateTo(k: VaultKey) {
    this.active = k;
    this.keys.set(k.kid, k.key);
  }

  async encrypt(plaintext: string, opts?: { exp?: number; meta?: Record<string, unknown> }): Promise<EncBlob> {
    const iv = randomBytes(12);
    const { ciphertext, tag } = await encryptAesGcm(this.active.key, iv, new TextEncoder().encode(plaintext));

    return {
      alg: 'A256GCM',
      kid: this.active.kid,
      iv: this.toBase64Url(iv),
      tag: this.toBase64Url(tag),
      data: this.toBase64Url(ciphertext),
      exp: opts?.exp,
      meta: opts?.meta,
    };
  }

  async decrypt(blob: EncBlob): Promise<string> {
    const key = this.keys.get(blob.kid);
    if (!key) throw new Error(`vault_unknown_kid:${blob.kid}`);

    const iv = this.fromBase64Url(blob.iv);
    const tag = this.fromBase64Url(blob.tag);
    const data = this.fromBase64Url(blob.data);

    const plaintext = await decryptAesGcm(key, iv, data, tag);
    return new TextDecoder().decode(plaintext);
  }

  private toBase64Url(data: Uint8Array): string {
    return Buffer.from(data).toString('base64url');
  }

  private fromBase64Url(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64url'));
  }
}
