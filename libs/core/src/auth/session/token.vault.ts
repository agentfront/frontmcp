// auth/session/token.vault.ts
import crypto from 'node:crypto';

export type EncBlob = {
  alg: 'A256GCM';
  kid: string; // master key id
  iv: string; // base64url
  tag: string; // base64url
  data: string; // base64url
  exp?: number; // optional epoch seconds
  meta?: Record<string, unknown>;
};

export type VaultKey = { kid: string; key: Buffer };

export class TokenVault {
  /** Active key used for new encryptions */
  private active: VaultKey;
  /** All known keys by kid for decryption (includes active) */
  private keys = new Map<string, Buffer>();

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

  encrypt(plaintext: string, opts?: { exp?: number; meta?: Record<string, unknown> }): EncBlob {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.active.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      alg: 'A256GCM',
      kid: this.active.kid,
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
      data: data.toString('base64url'),
      exp: opts?.exp,
      meta: opts?.meta,
    };
  }

  decrypt(blob: EncBlob): string {
    const key = this.keys.get(blob.kid);
    if (!key) throw new Error(`vault_unknown_kid:${blob.kid}`);
    const iv = Buffer.from(blob.iv, 'base64url');
    const tag = Buffer.from(blob.tag, 'base64url');
    const data = Buffer.from(blob.data, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return out.toString('utf8');
  }
}
