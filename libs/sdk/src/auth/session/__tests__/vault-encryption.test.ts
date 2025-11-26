/**
 * Vault Encryption Tests
 *
 * Tests for the zero-knowledge encryption system.
 */
import { VaultEncryption, VaultKeyDerivationClaims, EncryptedData, encryptedDataSchema } from '../vault-encryption';

describe('VaultEncryption', () => {
  const baseClaims: VaultKeyDerivationClaims = {
    jti: 'vault-123-abc',
    sub: 'user-456',
    iat: 1700000000,
    vaultKey: 'secret-vault-key-xyz',
  };

  describe('Key Derivation', () => {
    it('should derive a 32-byte key from claims', () => {
      const encryption = new VaultEncryption();
      const key = encryption.deriveKey(baseClaims);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive same key for same claims', () => {
      const encryption = new VaultEncryption();
      const key1 = encryption.deriveKey(baseClaims);
      const key2 = encryption.deriveKey(baseClaims);

      expect(key1.equals(key2)).toBe(true);
    });

    it('should derive different keys for different jti', () => {
      const encryption = new VaultEncryption();
      const key1 = encryption.deriveKey(baseClaims);
      const key2 = encryption.deriveKey({ ...baseClaims, jti: 'different-jti' });

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys for different sub', () => {
      const encryption = new VaultEncryption();
      const key1 = encryption.deriveKey(baseClaims);
      const key2 = encryption.deriveKey({ ...baseClaims, sub: 'different-user' });

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys for different vaultKey', () => {
      const encryption = new VaultEncryption();
      const key1 = encryption.deriveKey(baseClaims);
      const key2 = encryption.deriveKey({ ...baseClaims, vaultKey: 'different-vault-key' });

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys for different iat', () => {
      const encryption = new VaultEncryption();
      const key1 = encryption.deriveKey(baseClaims);
      const key2 = encryption.deriveKey({ ...baseClaims, iat: 1700000001 });

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive key without vaultKey claim', () => {
      const encryption = new VaultEncryption();
      const claims: VaultKeyDerivationClaims = {
        jti: 'vault-123',
        sub: 'user-456',
        iat: 1700000000,
      };

      const key = encryption.deriveKey(claims);
      expect(key.length).toBe(32);
    });

    it('should derive different keys with different peppers', () => {
      const encryption1 = new VaultEncryption({ pepper: 'pepper-1' });
      const encryption2 = new VaultEncryption({ pepper: 'pepper-2' });

      const key1 = encryption1.deriveKey(baseClaims);
      const key2 = encryption2.deriveKey(baseClaims);

      expect(key1.equals(key2)).toBe(false);
    });

    it('should derive different keys with different hkdfInfo', () => {
      const encryption1 = new VaultEncryption({ hkdfInfo: 'app-1' });
      const encryption2 = new VaultEncryption({ hkdfInfo: 'app-2' });

      const key1 = encryption1.deriveKey(baseClaims);
      const key2 = encryption2.deriveKey(baseClaims);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('Key Derivation from Token', () => {
    const mockToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQ1NiIsImp0aSI6InZhdWx0LTEyMyIsImlhdCI6MTcwMDAwMDAwMH0.mock-signature-123';

    it('should derive key from token and claims', () => {
      const encryption = new VaultEncryption();
      const key = encryption.deriveKeyFromToken(mockToken, baseClaims);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should derive different key than deriveKey (includes signature)', () => {
      const encryption = new VaultEncryption();
      const keyFromClaims = encryption.deriveKey(baseClaims);
      const keyFromToken = encryption.deriveKeyFromToken(mockToken, baseClaims);

      expect(keyFromClaims.equals(keyFromToken)).toBe(false);
    });

    it('should derive different keys for tokens with different signatures', () => {
      const encryption = new VaultEncryption();
      const token1 = 'header.payload.signature1';
      const token2 = 'header.payload.signature2';

      const key1 = encryption.deriveKeyFromToken(token1, baseClaims);
      const key2 = encryption.deriveKeyFromToken(token2, baseClaims);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('Encryption', () => {
    let encryption: VaultEncryption;
    let key: Buffer;

    beforeEach(() => {
      encryption = new VaultEncryption();
      key = encryption.deriveKey(baseClaims);
    });

    it('should encrypt plaintext', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encryption.encrypt(plaintext, key);

      expect(encrypted.v).toBe(1);
      expect(encrypted.alg).toBe('aes-256-gcm');
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ct).toBeDefined();
      expect(encrypted.tag).toBeDefined();
    });

    it('should produce valid encrypted data schema', () => {
      const plaintext = 'Test data';
      const encrypted = encryption.encrypt(plaintext, key);

      const result = encryptedDataSchema.safeParse(encrypted);
      expect(result.success).toBe(true);
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const plaintext = 'Same content';
      const encrypted1 = encryption.encrypt(plaintext, key);
      const encrypted2 = encryption.encrypt(plaintext, key);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ct).not.toBe(encrypted2.ct);
    });

    it('should encrypt empty string', () => {
      const encrypted = encryption.encrypt('', key);
      expect(encrypted.ct).toBeDefined();
    });

    it('should encrypt large data', () => {
      const largeData = 'x'.repeat(100000);
      const encrypted = encryption.encrypt(largeData, key);

      expect(encrypted.ct.length).toBeGreaterThan(0);
    });

    it('should encrypt JSON data', () => {
      const data = JSON.stringify({
        accessToken: 'secret-token',
        credentials: { user: 'admin', pass: 'secret' },
      });

      const encrypted = encryption.encrypt(data, key);
      expect(encrypted.ct).toBeDefined();
    });

    it('should throw for invalid key length', () => {
      const shortKey = Buffer.from('too-short', 'utf8');

      expect(() => {
        encryption.encrypt('test', shortKey);
      }).toThrow('Encryption key must be 32 bytes');
    });
  });

  describe('Decryption', () => {
    let encryption: VaultEncryption;
    let key: Buffer;

    beforeEach(() => {
      encryption = new VaultEncryption();
      key = encryption.deriveKey(baseClaims);
    });

    it('should decrypt to original plaintext', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encryption.encrypt(plaintext, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt empty string', () => {
      const encrypted = encryption.encrypt('', key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe('');
    });

    it('should decrypt large data', () => {
      const largeData = 'x'.repeat(100000);
      const encrypted = encryption.encrypt(largeData, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(largeData);
    });

    it('should decrypt JSON data', () => {
      const data = { secret: 'value', nested: { key: 'nested-value' } };
      const json = JSON.stringify(data);

      const encrypted = encryption.encrypt(json, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(JSON.parse(decrypted)).toEqual(data);
    });

    it('should fail with wrong key', () => {
      const plaintext = 'Secret data';
      const encrypted = encryption.encrypt(plaintext, key);

      const wrongKey = encryption.deriveKey({ ...baseClaims, jti: 'wrong-jti' });

      expect(() => {
        encryption.decrypt(encrypted, wrongKey);
      }).toThrow('Decryption failed');
    });

    it('should fail with tampered ciphertext', () => {
      const plaintext = 'Secret data';
      const encrypted = encryption.encrypt(plaintext, key);

      // Tamper with ciphertext
      const tampered: EncryptedData = {
        ...encrypted,
        ct: Buffer.from('tampered-data').toString('base64'),
      };

      expect(() => {
        encryption.decrypt(tampered, key);
      }).toThrow('Decryption failed');
    });

    it('should fail with tampered IV', () => {
      const plaintext = 'Secret data';
      const encrypted = encryption.encrypt(plaintext, key);

      // Tamper with IV
      const tampered: EncryptedData = {
        ...encrypted,
        iv: Buffer.from('tampered-iv!').toString('base64'),
      };

      expect(() => {
        encryption.decrypt(tampered, key);
      }).toThrow('Decryption failed');
    });

    it('should fail with tampered auth tag', () => {
      const plaintext = 'Secret data';
      const encrypted = encryption.encrypt(plaintext, key);

      // Tamper with auth tag
      const tampered: EncryptedData = {
        ...encrypted,
        tag: Buffer.from('tampered-tag-16b').toString('base64'),
      };

      expect(() => {
        encryption.decrypt(tampered, key);
      }).toThrow('Decryption failed');
    });

    it('should fail with invalid encrypted data format', () => {
      const invalid = {
        v: 2, // Wrong version
        alg: 'aes-256-gcm',
        iv: 'aaa',
        ct: 'bbb',
        tag: 'ccc',
      };

      expect(() => {
        encryption.decrypt(invalid as unknown as EncryptedData, key);
      }).toThrow('Invalid encrypted data format');
    });

    it('should throw for invalid key length', () => {
      const encrypted = encryption.encrypt('test', key);
      const shortKey = Buffer.from('too-short', 'utf8');

      expect(() => {
        encryption.decrypt(encrypted, shortKey);
      }).toThrow('Encryption key must be 32 bytes');
    });
  });

  describe('Object Encryption', () => {
    let encryption: VaultEncryption;
    let key: Buffer;

    beforeEach(() => {
      encryption = new VaultEncryption();
      key = encryption.deriveKey(baseClaims);
    });

    it('should encrypt and decrypt objects', () => {
      const data = {
        accessToken: 'xoxb-token-123',
        refreshToken: 'xoxr-refresh-456',
        scopes: ['chat:write', 'channels:read'],
        metadata: {
          teamId: 'T123',
          userId: 'U456',
        },
      };

      const encrypted = encryption.encryptObject(data, key);
      const decrypted = encryption.decryptObject<typeof data>(encrypted, key);

      expect(decrypted).toEqual(data);
    });

    it('should encrypt and decrypt arrays', () => {
      const data = ['item1', 'item2', { nested: true }];

      const encrypted = encryption.encryptObject(data, key);
      const decrypted = encryption.decryptObject<typeof data>(encrypted, key);

      expect(decrypted).toEqual(data);
    });

    it('should encrypt and decrypt null', () => {
      const encrypted = encryption.encryptObject(null, key);
      const decrypted = encryption.decryptObject<null>(encrypted, key);

      expect(decrypted).toBeNull();
    });

    it('should encrypt and decrypt complex nested structures', () => {
      const data = {
        providerTokens: {
          slack: {
            accessToken: 'slack-token',
            scopes: ['chat:write'],
          },
          github: {
            accessToken: 'github-token',
            scopes: ['repo'],
          },
        },
        appCredentials: {
          'openai:api': {
            type: 'api_key',
            key: 'sk-...',
          },
        },
        consent: {
          enabled: true,
          selectedToolIds: ['slack:send', 'github:issue'],
        },
      };

      const encrypted = encryption.encryptObject(data, key);
      const decrypted = encryption.decryptObject<typeof data>(encrypted, key);

      expect(decrypted).toEqual(data);
    });
  });

  describe('isEncrypted', () => {
    let encryption: VaultEncryption;
    let key: Buffer;

    beforeEach(() => {
      encryption = new VaultEncryption();
      key = encryption.deriveKey(baseClaims);
    });

    it('should return true for encrypted data', () => {
      const encrypted = encryption.encrypt('test', key);
      expect(encryption.isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain object', () => {
      const plainObject = { accessToken: 'token' };
      expect(encryption.isEncrypted(plainObject)).toBe(false);
    });

    it('should return false for string', () => {
      expect(encryption.isEncrypted('not encrypted')).toBe(false);
    });

    it('should return false for null', () => {
      expect(encryption.isEncrypted(null)).toBe(false);
    });

    it('should return false for partial encrypted format', () => {
      const partial = {
        v: 1,
        alg: 'aes-256-gcm',
        iv: 'test',
        // Missing ct and tag
      };
      expect(encryption.isEncrypted(partial)).toBe(false);
    });

    it('should return false for wrong version', () => {
      const wrongVersion = {
        v: 2,
        alg: 'aes-256-gcm',
        iv: 'test',
        ct: 'test',
        tag: 'test',
      };
      expect(encryption.isEncrypted(wrongVersion)).toBe(false);
    });
  });

  describe('Security Properties', () => {
    it('should not leak plaintext in encrypted data', () => {
      const encryption = new VaultEncryption();
      const key = encryption.deriveKey(baseClaims);
      const secret = 'super-secret-password-12345';

      const encrypted = encryption.encrypt(secret, key);
      const encryptedJson = JSON.stringify(encrypted);

      expect(encryptedJson).not.toContain(secret);
      expect(encrypted.ct).not.toContain(secret);
    });

    it('should produce cryptographically random IVs', () => {
      const encryption = new VaultEncryption();
      const key = encryption.deriveKey(baseClaims);

      const ivs = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const encrypted = encryption.encrypt('test', key);
        ivs.add(encrypted.iv);
      }

      // All IVs should be unique (collision probability is negligible)
      expect(ivs.size).toBe(100);
    });

    it('should derive different keys for minimal claim differences', () => {
      const encryption = new VaultEncryption();

      // Even 1-character difference should produce completely different key
      const key1 = encryption.deriveKey({ ...baseClaims, jti: 'vault-123-abc' });
      const key2 = encryption.deriveKey({ ...baseClaims, jti: 'vault-123-abd' });

      // Keys should differ in most bytes (not just a few)
      let differentBytes = 0;
      for (let i = 0; i < 32; i++) {
        if (key1[i] !== key2[i]) differentBytes++;
      }

      // With good key derivation, roughly half the bytes should differ
      expect(differentBytes).toBeGreaterThan(10);
    });
  });

  describe('Edge Cases', () => {
    let encryption: VaultEncryption;
    let key: Buffer;

    beforeEach(() => {
      encryption = new VaultEncryption();
      key = encryption.deriveKey(baseClaims);
    });

    it('should handle unicode characters', () => {
      const plaintext = '你好世界 🔐 مرحبا';
      const encrypted = encryption.encrypt(plaintext, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:\'"<>,.?/\\`~';
      const encrypted = encryption.encrypt(plaintext, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle newlines and whitespace', () => {
      const plaintext = 'line1\nline2\r\nline3\ttabbed';
      const encrypted = encryption.encrypt(plaintext, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle binary-like strings', () => {
      const plaintext = '\x00\x01\x02\xff\xfe\xfd';
      const encrypted = encryption.encrypt(plaintext, key);
      const decrypted = encryption.decrypt(encrypted, key);

      expect(decrypted).toBe(plaintext);
    });
  });
});
