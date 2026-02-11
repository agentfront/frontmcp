import { deriveEncryptionKey, encryptValue, decryptValue } from '../encryption';

describe('Encryption', () => {
  const secret = 'test-secret-key-for-encryption';
  let key: Uint8Array;

  beforeAll(() => {
    key = deriveEncryptionKey(secret);
  });

  describe('deriveEncryptionKey', () => {
    it('should derive a 32-byte key', () => {
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should derive the same key for the same secret', () => {
      const key2 = deriveEncryptionKey(secret);
      expect(Buffer.from(key).equals(Buffer.from(key2))).toBe(true);
    });

    it('should derive different keys for different secrets', () => {
      const key2 = deriveEncryptionKey('different-secret');
      expect(Buffer.from(key).equals(Buffer.from(key2))).toBe(false);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'hello world';
      const encrypted = encryptValue(key, plaintext);
      const decrypted = decryptValue(key, encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt JSON', () => {
      const data = JSON.stringify({ user: 'alice', token: 'abc123', nested: { ok: true } });
      const encrypted = encryptValue(key, data);
      const decrypted = decryptValue(key, encrypted);
      expect(JSON.parse(decrypted)).toEqual({ user: 'alice', token: 'abc123', nested: { ok: true } });
    });

    it('should encrypt and decrypt empty string', () => {
      const encrypted = encryptValue(key, '');
      const decrypted = decryptValue(key, encrypted);
      expect(decrypted).toBe('');
    });

    it('should encrypt and decrypt unicode', () => {
      const text = 'Hello \u{1F600} World \u{1F30D}';
      const encrypted = encryptValue(key, text);
      const decrypted = decryptValue(key, encrypted);
      expect(decrypted).toBe(text);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'same input';
      const e1 = encryptValue(key, plaintext);
      const e2 = encryptValue(key, plaintext);
      expect(e1).not.toBe(e2);
      // But both should decrypt to the same value
      expect(decryptValue(key, e1)).toBe(plaintext);
      expect(decryptValue(key, e2)).toBe(plaintext);
    });
  });

  describe('tamper detection', () => {
    it('should throw on invalid encrypted format', () => {
      expect(() => decryptValue(key, 'invalid')).toThrow('Invalid encrypted value format');
    });

    it('should throw when decrypting with wrong key', () => {
      const encrypted = encryptValue(key, 'secret data');
      const wrongKey = deriveEncryptionKey('wrong-secret');
      expect(() => decryptValue(wrongKey, encrypted)).toThrow();
    });

    it('should throw on tampered ciphertext', () => {
      const encrypted = encryptValue(key, 'secret data');
      const parts = encrypted.split(':');
      // Tamper with ciphertext
      parts[2] = parts[2].slice(0, -2) + 'XX';
      expect(() => decryptValue(key, parts.join(':'))).toThrow();
    });
  });
});
