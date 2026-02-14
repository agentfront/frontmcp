/**
 * Vault Encryption Tests
 *
 * Tests for VaultEncryption: key derivation, encrypt/decrypt round-trips,
 * object serialization, isEncrypted type guard, and error handling.
 *
 * Uses real crypto from @frontmcp/utils (no mocking).
 */

import { VaultEncryption, type VaultKeyDerivationClaims, type EncryptedData } from '../vault-encryption';

describe('VaultEncryption', () => {
  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------
  describe('constructor', () => {
    it('should create with default config', () => {
      const enc = new VaultEncryption();
      expect(enc).toBeInstanceOf(VaultEncryption);
    });

    it('should accept custom pepper', () => {
      const enc = new VaultEncryption({ pepper: 'my-pepper' });
      expect(enc).toBeInstanceOf(VaultEncryption);
    });

    it('should accept custom hkdfInfo', () => {
      const enc = new VaultEncryption({ hkdfInfo: 'custom-info-v2' });
      expect(enc).toBeInstanceOf(VaultEncryption);
    });

    it('should accept both pepper and hkdfInfo', () => {
      const enc = new VaultEncryption({ pepper: 'p', hkdfInfo: 'info' });
      expect(enc).toBeInstanceOf(VaultEncryption);
    });
  });

  // -----------------------------------------------------------------------
  // deriveKey
  // -----------------------------------------------------------------------
  describe('deriveKey', () => {
    const baseClaims: VaultKeyDerivationClaims = {
      jti: 'jwt-id-123',
      sub: 'user-1',
      iat: 1700000000,
    };

    it('should produce a 32-byte key', async () => {
      const enc = new VaultEncryption();
      const key = await enc.deriveKey(baseClaims);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should produce the same key for the same claims', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKey(baseClaims);
      const key2 = await enc.deriveKey(baseClaims);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });

    it('should produce different keys for different jti', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKey({ ...baseClaims, jti: 'aaa' });
      const key2 = await enc.deriveKey({ ...baseClaims, jti: 'bbb' });

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should produce different keys for different sub', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKey({ ...baseClaims, sub: 'user-A' });
      const key2 = await enc.deriveKey({ ...baseClaims, sub: 'user-B' });

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should produce different keys for different iat', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKey({ ...baseClaims, iat: 1000 });
      const key2 = await enc.deriveKey({ ...baseClaims, iat: 2000 });

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should produce different keys with different vaultKey', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKey({ ...baseClaims, vaultKey: 'vk-1' });
      const key2 = await enc.deriveKey({ ...baseClaims, vaultKey: 'vk-2' });

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should produce different keys with different pepper', async () => {
      const enc1 = new VaultEncryption({ pepper: 'pepper-A' });
      const enc2 = new VaultEncryption({ pepper: 'pepper-B' });

      const key1 = await enc1.deriveKey(baseClaims);
      const key2 = await enc2.deriveKey(baseClaims);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should produce different keys with different hkdfInfo', async () => {
      const enc1 = new VaultEncryption({ hkdfInfo: 'info-A' });
      const enc2 = new VaultEncryption({ hkdfInfo: 'info-B' });

      const key1 = await enc1.deriveKey(baseClaims);
      const key2 = await enc2.deriveKey(baseClaims);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // deriveKeyFromToken
  // -----------------------------------------------------------------------
  describe('deriveKeyFromToken', () => {
    const claims: VaultKeyDerivationClaims = {
      jti: 'jwt-id-456',
      sub: 'user-2',
      iat: 1700000000,
    };

    it('should produce a 32-byte key', async () => {
      const enc = new VaultEncryption();
      const key = await enc.deriveKeyFromToken('header.payload.signature', claims);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should include JWT signature in derivation (different from deriveKey)', async () => {
      const enc = new VaultEncryption();
      const keyFromToken = await enc.deriveKeyFromToken('h.p.sig123', claims);
      const keyFromClaims = await enc.deriveKey(claims);

      // Since deriveKeyFromToken includes the signature, it should differ
      expect(Buffer.from(keyFromToken).equals(Buffer.from(keyFromClaims))).toBe(false);
    });

    it('should produce different keys with different JWT signatures', async () => {
      const enc = new VaultEncryption();
      const key1 = await enc.deriveKeyFromToken('h.p.sig-A', claims);
      const key2 = await enc.deriveKeyFromToken('h.p.sig-B', claims);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('should handle JWT with no signature part gracefully', async () => {
      const enc = new VaultEncryption();
      // parts[2] is undefined => uses '' as signature
      const key = await enc.deriveKeyFromToken('header.payload', claims);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });
  });

  // -----------------------------------------------------------------------
  // encrypt / decrypt round-trip
  // -----------------------------------------------------------------------
  describe('encrypt / decrypt', () => {
    let enc: VaultEncryption;
    let key: Uint8Array;

    beforeAll(async () => {
      enc = new VaultEncryption({ pepper: 'test-pepper' });
      key = await enc.deriveKey({
        jti: 'test-jti',
        sub: 'test-sub',
        iat: 1700000000,
      });
    });

    it('should round-trip plaintext successfully', async () => {
      const plaintext = 'hello, world!';
      const encrypted = await enc.encrypt(plaintext, key);
      const decrypted = await enc.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip empty string', async () => {
      const encrypted = await enc.encrypt('', key);
      const decrypted = await enc.decrypt(encrypted, key);

      expect(decrypted).toBe('');
    });

    it('should round-trip large payload', async () => {
      const large = 'x'.repeat(100_000);
      const encrypted = await enc.encrypt(large, key);
      const decrypted = await enc.decrypt(encrypted, key);

      expect(decrypted).toBe(large);
    });

    it('should round-trip unicode text', async () => {
      const text = 'Hello \u2603 \ud83d\ude00 \u4e16\u754c';
      const encrypted = await enc.encrypt(text, key);
      const decrypted = await enc.decrypt(encrypted, key);

      expect(decrypted).toBe(text);
    });

    it('should produce encrypted data with correct structure', async () => {
      const encrypted = await enc.encrypt('test', key);

      expect(encrypted.v).toBe(1);
      expect(encrypted.alg).toBe('aes-256-gcm');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.ct).toBe('string');
      expect(typeof encrypted.tag).toBe('string');
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const encrypted1 = await enc.encrypt('same-text', key);
      const encrypted2 = await enc.encrypt('same-text', key);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ct).not.toBe(encrypted2.ct);
    });
  });

  // -----------------------------------------------------------------------
  // encrypt key validation
  // -----------------------------------------------------------------------
  describe('encrypt key validation', () => {
    it('should throw when key is not 32 bytes', async () => {
      const enc = new VaultEncryption();
      const shortKey = new Uint8Array(16);

      await expect(enc.encrypt('text', shortKey)).rejects.toThrow('Encryption key must be 32 bytes');
    });

    it('should throw when key is 0 bytes', async () => {
      const enc = new VaultEncryption();

      await expect(enc.encrypt('text', new Uint8Array(0))).rejects.toThrow('Encryption key must be 32 bytes');
    });

    it('should throw when key is 64 bytes', async () => {
      const enc = new VaultEncryption();

      await expect(enc.encrypt('text', new Uint8Array(64))).rejects.toThrow('Encryption key must be 32 bytes');
    });
  });

  // -----------------------------------------------------------------------
  // decrypt errors
  // -----------------------------------------------------------------------
  describe('decrypt errors', () => {
    let enc: VaultEncryption;
    let key: Uint8Array;

    beforeAll(async () => {
      enc = new VaultEncryption();
      key = await enc.deriveKey({ jti: 'j', sub: 's', iat: 1 });
    });

    it('should throw with wrong key', async () => {
      const encrypted = await enc.encrypt('secret-data', key);

      const wrongKey = await enc.deriveKey({ jti: 'different', sub: 's', iat: 1 });

      await expect(enc.decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should throw when key is not 32 bytes', async () => {
      const encrypted = await enc.encrypt('text', key);

      await expect(enc.decrypt(encrypted, new Uint8Array(16))).rejects.toThrow('Encryption key must be 32 bytes');
    });

    it('should throw with invalid encrypted data format', async () => {
      const invalid = { v: 2, alg: 'aes-256-gcm', iv: 'x', ct: 'y', tag: 'z' } as unknown as EncryptedData;

      await expect(enc.decrypt(invalid, key)).rejects.toThrow('Invalid encrypted data format');
    });

    it('should throw with missing fields in encrypted data', async () => {
      const partial = { v: 1, alg: 'aes-256-gcm' } as unknown as EncryptedData;

      await expect(enc.decrypt(partial, key)).rejects.toThrow('Invalid encrypted data format');
    });
  });

  // -----------------------------------------------------------------------
  // encryptObject / decryptObject round-trip
  // -----------------------------------------------------------------------
  describe('encryptObject / decryptObject', () => {
    let enc: VaultEncryption;
    let key: Uint8Array;

    beforeAll(async () => {
      enc = new VaultEncryption();
      key = await enc.deriveKey({ jti: 'j', sub: 's', iat: 1 });
    });

    it('should round-trip a simple object', async () => {
      const obj = { name: 'Alice', age: 30 };
      const encrypted = await enc.encryptObject(obj, key);
      const decrypted = await enc.decryptObject<typeof obj>(encrypted, key);

      expect(decrypted).toEqual(obj);
    });

    it('should round-trip a nested object', async () => {
      const obj = { user: { name: 'Bob' }, tokens: ['a', 'b'], count: 42 };
      const encrypted = await enc.encryptObject(obj, key);
      const decrypted = await enc.decryptObject<typeof obj>(encrypted, key);

      expect(decrypted).toEqual(obj);
    });

    it('should round-trip an array', async () => {
      const arr = [1, 2, 3, 'a', 'b'];
      const encrypted = await enc.encryptObject(arr, key);
      const decrypted = await enc.decryptObject<typeof arr>(encrypted, key);

      expect(decrypted).toEqual(arr);
    });

    it('should round-trip null', async () => {
      const encrypted = await enc.encryptObject(null, key);
      const decrypted = await enc.decryptObject<null>(encrypted, key);

      expect(decrypted).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // isEncrypted
  // -----------------------------------------------------------------------
  describe('isEncrypted', () => {
    it('should return true for valid encrypted data', () => {
      const enc = new VaultEncryption();
      const valid: EncryptedData = { v: 1, alg: 'aes-256-gcm', iv: 'abc', ct: 'def', tag: 'ghi' };

      expect(enc.isEncrypted(valid)).toBe(true);
    });

    it('should return false for null', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted('hello')).toBe(false);
    });

    it('should return false for object missing v', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted({ alg: 'aes-256-gcm', iv: 'a', ct: 'b', tag: 'c' })).toBe(false);
    });

    it('should return false for object with wrong v', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted({ v: 2, alg: 'aes-256-gcm', iv: 'a', ct: 'b', tag: 'c' })).toBe(false);
    });

    it('should return false for object with wrong alg', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted({ v: 1, alg: 'aes-128-cbc', iv: 'a', ct: 'b', tag: 'c' })).toBe(false);
    });

    it('should return false for empty object', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted({})).toBe(false);
    });

    it('should return false for number', () => {
      const enc = new VaultEncryption();
      expect(enc.isEncrypted(42)).toBe(false);
    });
  });
});
