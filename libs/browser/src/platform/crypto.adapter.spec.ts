// file: libs/browser/src/platform/crypto.adapter.spec.ts
/**
 * Tests for BrowserCryptoAdapter
 */

import { BrowserCryptoAdapter, browserCrypto } from './crypto.adapter';

describe('BrowserCryptoAdapter', () => {
  let adapter: BrowserCryptoAdapter;

  beforeEach(() => {
    adapter = new BrowserCryptoAdapter();
  });

  describe('randomUUID', () => {
    it('should generate a valid UUID v4', () => {
      const uuid = adapter.randomUUID();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidRegex);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(adapter.randomUUID());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('getRandomValues', () => {
    it('should fill array with random bytes', () => {
      const array = new Uint8Array(16);
      const result = adapter.getRandomValues(array);

      expect(result).toBe(array);
      // Check that array is not all zeros (very unlikely for random data)
      const hasNonZero = Array.from(array).some((b) => b !== 0);
      expect(hasNonZero).toBe(true);
    });

    it('should generate different values each time', () => {
      const array1 = new Uint8Array(16);
      const array2 = new Uint8Array(16);

      adapter.getRandomValues(array1);
      adapter.getRandomValues(array2);

      const hex1 = Array.from(array1)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const hex2 = Array.from(array2)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      expect(hex1).not.toBe(hex2);
    });
  });

  describe('getRandomHex', () => {
    it('should generate hex string of correct length', () => {
      expect(adapter.getRandomHex(8)).toHaveLength(8);
      expect(adapter.getRandomHex(16)).toHaveLength(16);
      expect(adapter.getRandomHex(32)).toHaveLength(32);
    });

    it('should only contain hex characters', () => {
      const hex = adapter.getRandomHex(32);
      expect(hex).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate different values each time', () => {
      const hex1 = adapter.getRandomHex(16);
      const hex2 = adapter.getRandomHex(16);
      expect(hex1).not.toBe(hex2);
    });
  });

  describe('sha256', () => {
    it('should hash a string', async () => {
      const hash = await adapter.sha256('hello');

      // Known SHA-256 hash of "hello"
      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should hash a Uint8Array', async () => {
      const data = new TextEncoder().encode('hello');
      const hash = await adapter.sha256(data);

      expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });

    it('should produce consistent hashes for same input', async () => {
      const hash1 = await adapter.sha256('test input');
      const hash2 = await adapter.sha256('test input');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', async () => {
      const hash1 = await adapter.sha256('input1');
      const hash2 = await adapter.sha256('input2');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce 64 character hex string', async () => {
      const hash = await adapter.sha256('test');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('singleton', () => {
    it('should export a singleton instance', () => {
      expect(browserCrypto).toBeInstanceOf(BrowserCryptoAdapter);
    });

    it('should work with singleton', () => {
      const uuid = browserCrypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });
});
