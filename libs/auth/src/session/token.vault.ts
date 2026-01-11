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
      iv: base64urlEncode(iv),
      tag: base64urlEncode(tag),
      data: base64urlEncode(ciphertext),
      exp: opts?.exp,
      meta: opts?.meta,
    };
  }

  async decrypt(blob: EncBlob): Promise<string> {
    const key = this.keys.get(blob.kid);
    if (!key) throw new Error(`vault_unknown_kid:${blob.kid}`);

    const iv = base64urlDecode(blob.iv);
    const tag = base64urlDecode(blob.tag);
    const data = base64urlDecode(blob.data);

    const plaintext = await decryptAesGcm(key, data, iv, tag);
    return new TextDecoder().decode(plaintext);
  }
}
