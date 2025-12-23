// file: libs/sdk/src/utils/__tests__/platform-crypto.test.ts
import { generateUUID, getRandomBytes, getRandomHex, sha256, sha256Sync, simpleHash } from '../platform-crypto';

describe('Platform Crypto', () => {
  describe('generateUUID', () => {
    it('should generate valid UUID v4', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
      expect(uuids.size).toBe(100);
    });

    it('should generate 36 character UUIDs', () => {
      const uuid = generateUUID();
      expect(uuid.length).toBe(36);
    });
  });

  describe('getRandomBytes', () => {
    it('should return correct length', () => {
      const bytes = getRandomBytes(16);
      expect(bytes.length).toBe(16);
    });

    it('should return Uint8Array', () => {
      const bytes = getRandomBytes(8);
      expect(bytes).toBeInstanceOf(Uint8Array);
    });

    it('should return different values on each call', () => {
      const bytes1 = getRandomBytes(16);
      const bytes2 = getRandomBytes(16);
      // Very unlikely to be equal
      expect(bytes1).not.toEqual(bytes2);
    });

    it('should handle zero length', () => {
      const bytes = getRandomBytes(0);
      expect(bytes.length).toBe(0);
    });

    it('should handle large lengths', () => {
      const bytes = getRandomBytes(1024);
      expect(bytes.length).toBe(1024);
    });
  });

  describe('getRandomHex', () => {
    it('should return hex string of correct length', () => {
      const hex = getRandomHex(8);
      expect(hex.length).toBe(16); // 8 bytes = 16 hex chars
      expect(hex).toMatch(/^[0-9a-f]+$/);
    });

    it('should return valid hex string', () => {
      const hex = getRandomHex(4);
      expect(hex).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should return unique values', () => {
      const hexValues = new Set(Array.from({ length: 50 }, () => getRandomHex(8)));
      expect(hexValues.size).toBe(50);
    });
  });

  describe('sha256', () => {
    it('should hash string correctly', async () => {
      const hash = await sha256('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash empty string correctly', async () => {
      const hash = await sha256('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should produce consistent hashes', async () => {
      const hash1 = await sha256('test');
      const hash2 = await sha256('test');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await sha256('hello');
      const hash2 = await sha256('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should return 64 character hex string', async () => {
      const hash = await sha256('any string');
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('sha256Sync', () => {
    it('should hash string correctly in Node.js', () => {
      const hash = sha256Sync('hello');
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash empty string correctly', () => {
      const hash = sha256Sync('');
      expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should produce same result as async sha256', async () => {
      const syncHash = sha256Sync('test string');
      const asyncHash = await sha256('test string');
      expect(syncHash).toBe(asyncHash);
    });
  });

  describe('simpleHash', () => {
    it('should return hex string', () => {
      const hash = simpleHash('hello');
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should produce consistent results', () => {
      const hash1 = simpleHash('test');
      const hash2 = simpleHash('test');
      expect(hash1).toBe(hash2);
    });

    it('should produce different results for different inputs', () => {
      const hash1 = simpleHash('hello');
      const hash2 = simpleHash('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = simpleHash('');
      expect(hash).toBe('0');
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(10000);
      const hash = simpleHash(longString);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });
});
