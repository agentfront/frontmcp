/**
 * Browser Paths Tests
 *
 * Tests for the browser-specific code paths in crypto/index.ts.
 * These tests temporarily mock Buffer to undefined to trigger
 * the browser fallback code paths (using btoa/atob).
 */

import { browserCrypto } from '../browser';

describe('Browser Crypto Provider', () => {
  describe('browserCrypto.randomUUID', () => {
    it('should generate valid UUID', () => {
      const uuid = browserCrypto.randomUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        uuids.add(browserCrypto.randomUUID());
      }
      expect(uuids.size).toBe(10);
    });
  });

  describe('browserCrypto.timingSafeEqual', () => {
    it('should return true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(browserCrypto.timingSafeEqual(a, b)).toBe(true);
    });

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(browserCrypto.timingSafeEqual(a, b)).toBe(false);
    });

    it('should return false for different length arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(browserCrypto.timingSafeEqual(a, b)).toBe(false);
    });

    it('should handle empty arrays', () => {
      const a = new Uint8Array([]);
      const b = new Uint8Array([]);
      expect(browserCrypto.timingSafeEqual(a, b)).toBe(true);
    });
  });

  describe('browserCrypto.sha256', () => {
    it('should hash string data', () => {
      const hash = browserCrypto.sha256('test');
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('should hash Uint8Array data', () => {
      const data = new TextEncoder().encode('test');
      const hash = browserCrypto.sha256(data);
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });
  });

  describe('browserCrypto.sha256Hex', () => {
    it('should return hex string', () => {
      const hash = browserCrypto.sha256Hex('test');
      expect(typeof hash).toBe('string');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('browserCrypto.hmacSha256', () => {
    it('should compute HMAC', () => {
      const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const data = new Uint8Array([9, 10, 11, 12]);
      const hmac = browserCrypto.hmacSha256(key, data);
      expect(hmac).toBeInstanceOf(Uint8Array);
      expect(hmac.length).toBe(32);
    });
  });

  describe('browserCrypto.hkdfSha256', () => {
    it('should derive key material', () => {
      const ikm = new Uint8Array(32).fill(0x42);
      const salt = new Uint8Array(16).fill(0x24);
      const info = new TextEncoder().encode('test');
      const derived = browserCrypto.hkdfSha256(ikm, salt, info, 32);
      expect(derived).toBeInstanceOf(Uint8Array);
      expect(derived.length).toBe(32);
    });

    it('should handle empty salt', () => {
      const ikm = new Uint8Array(32).fill(0x42);
      const salt = new Uint8Array(0);
      const info = new TextEncoder().encode('test');
      const derived = browserCrypto.hkdfSha256(ikm, salt, info, 32);
      expect(derived.length).toBe(32);
    });
  });

  describe('browserCrypto.randomBytes', () => {
    it('should generate random bytes', () => {
      const bytes = browserCrypto.randomBytes(16);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(16);
    });

    it('should generate different bytes each time', () => {
      const a = browserCrypto.randomBytes(16);
      const b = browserCrypto.randomBytes(16);
      expect(a).not.toEqual(b);
    });
  });

  describe('browserCrypto AES-GCM', () => {
    it('should encrypt and decrypt', () => {
      const key = new Uint8Array(32).fill(0x42);
      const iv = new Uint8Array(12).fill(0x24);
      const plaintext = new TextEncoder().encode('Hello, World!');

      const { ciphertext, tag } = browserCrypto.encryptAesGcm(key, plaintext, iv);
      expect(ciphertext.length).toBeGreaterThan(0);
      expect(tag.length).toBe(16);

      const decrypted = browserCrypto.decryptAesGcm(key, ciphertext, iv, tag);
      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
    });
  });
});

describe('Browser UUID Fallback', () => {
  // Test the UUID fallback when crypto.randomUUID is not available
  const originalCrypto = globalThis.crypto;
  const originalRandomUUID = globalThis.crypto?.randomUUID;

  describe('with crypto.randomUUID mocked as undefined', () => {
    beforeAll(() => {
      // Mock crypto.randomUUID as undefined
      if (globalThis.crypto) {
        // @ts-expect-error - intentionally mocking
        globalThis.crypto.randomUUID = undefined;
      }
    });

    afterAll(() => {
      // Restore original crypto.randomUUID
      if (globalThis.crypto && originalRandomUUID) {
        globalThis.crypto.randomUUID = originalRandomUUID;
      }
    });

    it('should generate UUID using fallback method', () => {
      jest.resetModules();
      const { browserCrypto: freshBrowserCrypto } = require('../browser');

      const uuid = freshBrowserCrypto.randomUUID();
      // Should still be valid UUID v4 format
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs using fallback', () => {
      jest.resetModules();
      const { browserCrypto: freshBrowserCrypto } = require('../browser');

      const uuids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        uuids.add(freshBrowserCrypto.randomUUID());
      }
      expect(uuids.size).toBe(10);
    });
  });
});

describe('Browser Code Paths', () => {
  // Store original Buffer
  const originalBuffer = globalThis.Buffer;

  describe('with Buffer mocked as undefined', () => {
    beforeAll(() => {
      // Mock Buffer as undefined to trigger browser paths
      // @ts-expect-error - intentionally mocking Buffer
      globalThis.Buffer = undefined;
    });

    afterAll(() => {
      // Restore original Buffer
      globalThis.Buffer = originalBuffer;
    });

    describe('base64urlEncode (browser path)', () => {
      it('should encode using btoa fallback', () => {
        // Re-import to pick up the mocked Buffer
        jest.resetModules();
        const { base64urlEncode } = require('../index');

        const bytes = new TextEncoder().encode('Hello, World!');
        const encoded = base64urlEncode(bytes);

        // Verify result is valid base64url (no +, /, or =)
        expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ');
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        expect(encoded).not.toContain('=');
      });

      it('should handle empty array', () => {
        jest.resetModules();
        const { base64urlEncode } = require('../index');

        expect(base64urlEncode(new Uint8Array([]))).toBe('');
      });
    });

    describe('base64urlDecode (browser path)', () => {
      it('should decode using atob fallback', () => {
        jest.resetModules();
        const { base64urlDecode } = require('../index');

        const decoded = base64urlDecode('SGVsbG8sIFdvcmxkIQ');
        expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
      });

      it('should handle empty string', () => {
        jest.resetModules();
        const { base64urlDecode } = require('../index');

        expect(base64urlDecode('')).toEqual(new Uint8Array([]));
      });

      it('should handle URL-safe characters', () => {
        jest.resetModules();
        const { base64urlEncode, base64urlDecode } = require('../index');

        // Test roundtrip with bytes that produce URL-unsafe chars in regular base64
        const original = new Uint8Array([0xfb, 0xff, 0xfe]);
        const encoded = base64urlEncode(original);
        const decoded = base64urlDecode(encoded);
        expect(decoded).toEqual(original);
      });
    });

    describe('base64Encode (browser path)', () => {
      it('should encode using btoa fallback', () => {
        jest.resetModules();
        const { base64Encode } = require('../index');

        const bytes = new TextEncoder().encode('Hello, World!');
        const encoded = base64Encode(bytes);
        expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
      });

      it('should handle empty array', () => {
        jest.resetModules();
        const { base64Encode } = require('../index');

        expect(base64Encode(new Uint8Array([]))).toBe('');
      });
    });

    describe('base64Decode (browser path)', () => {
      it('should decode using atob fallback', () => {
        jest.resetModules();
        const { base64Decode } = require('../index');

        const decoded = base64Decode('SGVsbG8sIFdvcmxkIQ==');
        expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
      });

      it('should handle empty string', () => {
        jest.resetModules();
        const { base64Decode } = require('../index');

        expect(base64Decode('')).toEqual(new Uint8Array([]));
      });

      it('should roundtrip correctly', () => {
        jest.resetModules();
        const { base64Encode, base64Decode } = require('../index');

        const original = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255]);
        const encoded = base64Encode(original);
        const decoded = base64Decode(encoded);
        expect(decoded).toEqual(original);
      });
    });
  });
});
