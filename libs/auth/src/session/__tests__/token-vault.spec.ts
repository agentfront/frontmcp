/**
 * Token Vault Tests
 *
 * Tests for TokenVault: construction validation, encrypt/decrypt round-trips,
 * key rotation, expiry handling, and error cases.
 *
 * Uses real crypto from @frontmcp/utils (no mocking).
 */

import { base64urlEncode, encryptAesGcm, randomBytes } from '@frontmcp/utils';

import { TokenVault, type EncBlob, type VaultKey } from '../token.vault';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKey(kid: string): VaultKey {
  return { kid, key: randomBytes(32) };
}

/** A blob as TokenVault wrote it before `kid` and `exp` were bound: encrypted under the master key, no `v`. */
function encryptWithoutBinding(vaultKey: VaultKey, plaintext: string, exp?: number): EncBlob {
  const iv = randomBytes(12);
  const { ciphertext, tag } = encryptAesGcm(vaultKey.key, new TextEncoder().encode(plaintext), iv);
  return {
    alg: 'A256GCM',
    kid: vaultKey.kid,
    iv: base64urlEncode(iv),
    tag: base64urlEncode(tag),
    data: base64urlEncode(ciphertext),
    exp,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TokenVault', () => {
  // -----------------------------------------------------------------------
  // Constructor validation
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should succeed with a single valid key', () => {
      const vault = new TokenVault([makeKey('k1')]);
      expect(vault).toBeInstanceOf(TokenVault);
    });

    it('should succeed with multiple valid keys', () => {
      const vault = new TokenVault([makeKey('k1'), makeKey('k2'), makeKey('k3')]);
      expect(vault).toBeInstanceOf(TokenVault);
    });

    it('should throw when no keys provided (empty array)', () => {
      expect(() => new TokenVault([])).toThrow('TokenVault requires at least one key');
    });

    it('should throw when keys is not an array', () => {
      expect(() => new TokenVault(null as unknown as VaultKey[])).toThrow('TokenVault requires at least one key');
    });

    it('should throw for key with wrong size (16 bytes)', () => {
      const badKey: VaultKey = { kid: 'bad', key: randomBytes(16) };

      expect(() => new TokenVault([badKey])).toThrow('TokenVault key "bad" must be a 32-byte Uint8Array');
    });

    it('should throw for key with wrong size (64 bytes)', () => {
      const badKey: VaultKey = { kid: 'big', key: randomBytes(64) };

      expect(() => new TokenVault([badKey])).toThrow('TokenVault key "big" must be a 32-byte Uint8Array');
    });

    it('should throw for key that is not Uint8Array', () => {
      const badKey = { kid: 'y', key: new Array(32).fill(0) } as unknown as VaultKey;

      expect(() => new TokenVault([badKey])).toThrow('TokenVault key "y" must be a 32-byte Uint8Array');
    });

    it('should detect duplicate kid values', () => {
      const k1 = makeKey('dup');
      const k2 = makeKey('dup');

      expect(() => new TokenVault([k1, k2])).toThrow('TokenVault duplicate kid: "dup"');
    });

    it('should accept keys with different kids', () => {
      expect(() => new TokenVault([makeKey('a'), makeKey('b')])).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // encrypt / decrypt round-trip
  // -----------------------------------------------------------------------
  describe('encrypt / decrypt', () => {
    it('should round-trip plaintext', async () => {
      const vault = new TokenVault([makeKey('primary')]);

      const blob = await vault.encrypt('secret-data');
      const decrypted = await vault.decrypt(blob);

      expect(decrypted).toBe('secret-data');
    });

    it('should round-trip empty string', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob = await vault.encrypt('');
      const decrypted = await vault.decrypt(blob);

      expect(decrypted).toBe('');
    });

    it('should round-trip JSON payload', async () => {
      const vault = new TokenVault([makeKey('k')]);
      const json = JSON.stringify({ accessToken: 'at-123', refreshToken: 'rt-456' });

      const blob = await vault.encrypt(json);
      const decrypted = await vault.decrypt(blob);

      expect(JSON.parse(decrypted)).toEqual({ accessToken: 'at-123', refreshToken: 'rt-456' });
    });

    it('should produce blob with correct structure', async () => {
      const vault = new TokenVault([makeKey('my-kid')]);

      const blob = await vault.encrypt('test');

      expect(blob.alg).toBe('A256GCM');
      expect(blob.kid).toBe('my-kid');
      expect(typeof blob.iv).toBe('string');
      expect(typeof blob.tag).toBe('string');
      expect(typeof blob.data).toBe('string');
      expect(blob.exp).toBeUndefined();
      expect(blob.meta).toBeUndefined();
      expect(blob.v).toBe(2);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob1 = await vault.encrypt('same');
      const blob2 = await vault.encrypt('same');

      expect(blob1.iv).not.toBe(blob2.iv);
      expect(blob1.data).not.toBe(blob2.data);
    });
  });

  // -----------------------------------------------------------------------
  // encrypt uses active (first) key
  // -----------------------------------------------------------------------
  describe('active key selection', () => {
    it('should use first key (active) for encryption', async () => {
      const k1 = makeKey('first');
      const k2 = makeKey('second');
      const vault = new TokenVault([k1, k2]);

      const blob = await vault.encrypt('data');

      expect(blob.kid).toBe('first');
    });
  });

  // -----------------------------------------------------------------------
  // encrypt with opts
  // -----------------------------------------------------------------------
  describe('encrypt with opts', () => {
    it('should include exp when provided', async () => {
      const vault = new TokenVault([makeKey('k')]);
      const futureExp = Math.floor(Date.now() / 1000) + 7200;

      const blob = await vault.encrypt('data', { exp: futureExp });

      expect(blob.exp).toBe(futureExp);

      // Should decrypt fine since exp is in the future
      expect(await vault.decrypt(blob)).toBe('data');
    });

    it('should include meta when provided', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob = await vault.encrypt('data', { meta: { provider: 'github', scope: 'repo' } });

      expect(blob.meta).toEqual({ provider: 'github', scope: 'repo' });
    });

    it('should include both exp and meta', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob = await vault.encrypt('data', {
        exp: Math.floor(Date.now() / 1000) + 3600,
        meta: { note: 'test' },
      });

      expect(blob.exp).toBeDefined();
      expect(blob.meta).toEqual({ note: 'test' });
    });
  });

  // -----------------------------------------------------------------------
  // Key rotation
  // -----------------------------------------------------------------------
  describe('key rotation', () => {
    it('should decrypt with rotated key after rotateTo', async () => {
      const k1 = makeKey('v1');
      const k2 = makeKey('v2');
      const vault = new TokenVault([k1]);

      // Encrypt with v1
      const blobV1 = await vault.encrypt('data-v1');
      expect(blobV1.kid).toBe('v1');

      // Rotate to v2
      vault.rotateTo(k2);

      // New encryptions use v2
      const blobV2 = await vault.encrypt('data-v2');
      expect(blobV2.kid).toBe('v2');

      // Both old and new blobs can be decrypted
      expect(await vault.decrypt(blobV1)).toBe('data-v1');
      expect(await vault.decrypt(blobV2)).toBe('data-v2');
    });

    it('should decrypt with old key when multiple keys provided at construction', async () => {
      const k1 = makeKey('old');
      const k2 = makeKey('new');
      const vault = new TokenVault([k2, k1]); // k2 is active

      // Encrypt a blob with k1 externally (simulate)
      const vaultK1 = new TokenVault([k1]);
      const blobFromK1 = await vaultK1.encrypt('old-data');

      // The main vault should be able to decrypt with k1 (old key)
      expect(await vault.decrypt(blobFromK1)).toBe('old-data');
    });

    it('rotateTo should validate key size', () => {
      const vault = new TokenVault([makeKey('k1')]);

      expect(() => vault.rotateTo({ kid: 'bad', key: randomBytes(16) })).toThrow(
        'TokenVault key "bad" must be a 32-byte Uint8Array',
      );
    });

    it('rotateTo should allow overwriting existing kid', async () => {
      const k1 = makeKey('shared-kid');
      const vault = new TokenVault([k1]);

      const blob = await vault.encrypt('before');

      // Rotate with same kid but new key material
      const k2: VaultKey = { kid: 'shared-kid', key: randomBytes(32) };
      vault.rotateTo(k2);

      // Old blob encrypted with old key won't decrypt anymore (key material changed)
      await expect(vault.decrypt(blob)).rejects.toThrow(/decrypt|tag|authenticat/i);

      // New blob works
      const newBlob = await vault.encrypt('after');
      expect(await vault.decrypt(newBlob)).toBe('after');
    });
  });

  // -----------------------------------------------------------------------
  // Expiry handling
  // -----------------------------------------------------------------------
  describe('expiry', () => {
    it('should throw vault_expired:kid for expired blob', async () => {
      const vault = new TokenVault([makeKey('k1')]);

      // Encrypt with exp in the past
      const blob = await vault.encrypt('expired-data', {
        exp: Math.floor(Date.now() / 1000) - 100,
      });

      await expect(vault.decrypt(blob)).rejects.toThrow('vault_expired:k1');
    });

    it('should decrypt non-expired blob successfully', async () => {
      const vault = new TokenVault([makeKey('k1')]);

      const blob = await vault.encrypt('fresh-data', {
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      expect(await vault.decrypt(blob)).toBe('fresh-data');
    });

    it('should decrypt blob without exp (no expiry)', async () => {
      const vault = new TokenVault([makeKey('k1')]);

      const blob = await vault.encrypt('no-expiry');
      expect(blob.exp).toBeUndefined();

      expect(await vault.decrypt(blob)).toBe('no-expiry');
    });

    it('should include kid in vault_expired error message', async () => {
      const vault = new TokenVault([makeKey('my-special-kid')]);

      const blob = await vault.encrypt('data', {
        exp: Math.floor(Date.now() / 1000) - 1,
      });

      await expect(vault.decrypt(blob)).rejects.toThrow('vault_expired:my-special-kid');
    });
  });

  // -----------------------------------------------------------------------
  // Unknown kid
  // -----------------------------------------------------------------------
  describe('unknown kid', () => {
    it('should throw vault_unknown_kid for blob with unrecognized kid', async () => {
      const k1 = makeKey('k1');
      const vault1 = new TokenVault([k1]);
      const blob = await vault1.encrypt('data');

      // Create a different vault that does not know kid "k1"
      const vault2 = new TokenVault([makeKey('k2')]);

      await expect(vault2.decrypt(blob)).rejects.toThrow('vault_unknown_kid:k1');
    });

    it('should include kid in vault_unknown_kid error message', async () => {
      const vault = new TokenVault([makeKey('known')]);

      const realBlob = await vault.encrypt('data');
      const fakeBlob: EncBlob = { ...realBlob, kid: 'mysterious-kid' };

      await expect(vault.decrypt(fakeBlob)).rejects.toThrow('vault_unknown_kid:mysterious-kid');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle unicode plaintext', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob = await vault.encrypt('\u4e16\u754c \ud83c\udf0d \u2603');
      expect(await vault.decrypt(blob)).toBe('\u4e16\u754c \ud83c\udf0d \u2603');
    });

    it('should handle large plaintext', async () => {
      const vault = new TokenVault([makeKey('k')]);
      const large = 'A'.repeat(50_000);

      const blob = await vault.encrypt(large);
      expect(await vault.decrypt(blob)).toBe(large);
    });

    it('should decrypt blob with exp=undefined explicitly', async () => {
      const vault = new TokenVault([makeKey('k')]);

      const blob = await vault.encrypt('data');
      blob.exp = undefined;

      expect(await vault.decrypt(blob)).toBe('data');
    });
  });

  // -----------------------------------------------------------------------
  // kid and exp bound to the ciphertext
  // -----------------------------------------------------------------------
  describe('bound kid and exp', () => {
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    it('should refuse a blob whose exp was raised', async () => {
      const vault = new TokenVault([makeKey('k1')]);
      const blob = await vault.encrypt('secret', { exp: nowSeconds() + 60 });

      await expect(vault.decrypt({ ...blob, exp: nowSeconds() + 86_400 })).rejects.toThrow();
    });

    it('should refuse a blob whose exp was removed', async () => {
      const vault = new TokenVault([makeKey('k1')]);
      const blob = await vault.encrypt('secret', { exp: nowSeconds() + 60 });

      await expect(vault.decrypt({ ...blob, exp: undefined })).rejects.toThrow();
    });

    it('should refuse a blob given an exp it was not encrypted with', async () => {
      const vault = new TokenVault([makeKey('k1')]);
      const blob = await vault.encrypt('secret');

      await expect(vault.decrypt({ ...blob, exp: nowSeconds() + 60 })).rejects.toThrow();
    });

    it('should refuse a blob whose kid names another key with the same key material', async () => {
      const material = randomBytes(32);
      const vault = new TokenVault([
        { kid: 'k1', key: material },
        { kid: 'k2', key: material },
      ]);
      const blob = await vault.encrypt('secret');

      await expect(vault.decrypt({ ...blob, kid: 'k2' })).rejects.toThrow();
    });

    it('should refuse a version 2 blob presented without its version', async () => {
      const vault = new TokenVault([makeKey('k1')]);
      const blob = await vault.encrypt('secret', { exp: nowSeconds() + 60 });

      await expect(vault.decrypt({ ...blob, v: undefined })).rejects.toThrow();
    });

    it('should bind the key and exp it started with, though the key rotates or exp changes while it encrypts', async () => {
      const vault = new TokenVault([makeKey('k1')]);
      const opts = { exp: nowSeconds() + 60 };
      const encrypting = vault.encrypt('secret', opts);
      vault.rotateTo(makeKey('k2'));
      opts.exp = nowSeconds() + 86_400;

      const blob = await encrypting;
      expect(blob.kid).toBe('k1');
      expect(blob.exp).toBeLessThan(nowSeconds() + 3600);
      expect(await vault.decrypt(blob)).toBe('secret');
    });

    it('should still decrypt a blob written before the binding, with or without exp', async () => {
      const k1 = makeKey('k1');
      const vault = new TokenVault([k1]);
      const blobWrittenBefore = encryptWithoutBinding(k1, 'written-before', nowSeconds() + 60);

      expect(await vault.decrypt(blobWrittenBefore)).toBe('written-before');
      expect(await vault.decrypt({ ...blobWrittenBefore, exp: undefined })).toBe('written-before');
    });

    it('should still refuse an expired blob written before the binding', async () => {
      const k1 = makeKey('k1');
      const vault = new TokenVault([k1]);
      const blobWrittenBefore = encryptWithoutBinding(k1, 'written-before', nowSeconds() - 1);

      await expect(vault.decrypt(blobWrittenBefore)).rejects.toThrow('vault_expired:k1');
    });
  });
});
