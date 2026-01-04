/**
 * Cross-Platform Crypto Module Tests
 *
 * Tests for the crypto abstraction layer ensuring:
 * 1. All crypto operations work correctly
 * 2. Node.js and browser implementations produce identical output
 * 3. Known test vectors pass
 */

import {
  getCrypto,
  randomUUID,
  randomBytes,
  sha256,
  sha256Hex,
  hmacSha256,
  hkdfSha256,
  encryptAesGcm,
  decryptAesGcm,
  timingSafeEqual,
  bytesToHex,
  base64urlEncode,
  base64urlDecode,
  sha256Base64url,
  isNode,
  isBrowser,
} from '../index';
import { nodeCrypto } from '../node';
import { browserCrypto } from '../browser';

describe('Crypto Module', () => {
  describe('Runtime Detection', () => {
    it('should detect Node.js environment', () => {
      expect(isNode()).toBe(true);
    });

    it('should detect browser-like environment', () => {
      // In Node.js with globalThis.crypto available, this may be true
      expect(typeof isBrowser()).toBe('boolean');
    });

    it('should return a crypto provider', () => {
      const provider = getCrypto();
      expect(provider).toBeDefined();
      expect(typeof provider.randomUUID).toBe('function');
      expect(typeof provider.sha256).toBe('function');
    });
  });

  describe('UUID Generation', () => {
    it('should generate valid UUID v4', () => {
      const uuid = randomUUID();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(randomUUID());
      }
      expect(uuids.size).toBe(100);
    });

    it('should produce same format in Node and browser implementations', () => {
      const nodeUuid = nodeCrypto.randomUUID();
      const browserUuid = browserCrypto.randomUUID();
      expect(nodeUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(browserUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('Random Bytes', () => {
    it('should generate bytes of requested length', () => {
      const bytes16 = randomBytes(16);
      const bytes32 = randomBytes(32);
      const bytes64 = randomBytes(64);

      expect(bytes16).toBeInstanceOf(Uint8Array);
      expect(bytes16.length).toBe(16);
      expect(bytes32.length).toBe(32);
      expect(bytes64.length).toBe(64);
    });

    it('should generate different bytes each time', () => {
      const a = randomBytes(32);
      const b = randomBytes(32);
      expect(a).not.toEqual(b);
    });

    it('should throw for zero length', () => {
      expect(() => randomBytes(0)).toThrow('randomBytes length must be a positive integer');
    });

    it('should throw for negative length', () => {
      expect(() => randomBytes(-1)).toThrow('randomBytes length must be a positive integer');
    });

    it('should throw for non-integer length', () => {
      expect(() => randomBytes(3.5)).toThrow('randomBytes length must be a positive integer');
    });

    it('should throw for NaN', () => {
      expect(() => randomBytes(NaN)).toThrow('randomBytes length must be a positive integer');
    });

    it('should throw for Infinity', () => {
      expect(() => randomBytes(Infinity)).toThrow('randomBytes length must be a positive integer');
    });
  });

  describe('SHA-256 Hashing', () => {
    // Known test vectors from NIST
    const testVectors = [
      {
        input: '',
        expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        input: 'abc',
        expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
      {
        input: 'The quick brown fox jumps over the lazy dog',
        expected: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
      },
    ];

    testVectors.forEach(({ input, expected }) => {
      it(`should hash "${input.slice(0, 20)}..." correctly`, () => {
        const hash = sha256Hex(input);
        expect(hash).toBe(expected);
      });
    });

    it('should return Uint8Array from sha256()', () => {
      const hash = sha256('test');
      expect(hash).toBeInstanceOf(Uint8Array);
      expect(hash.length).toBe(32);
    });

    it('should handle Uint8Array input', () => {
      const input = new TextEncoder().encode('test');
      const hash = sha256Hex(input);
      expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
    });

    it('should produce identical output from Node and browser implementations', () => {
      const input = 'Cross-platform crypto test';
      const nodeHash = nodeCrypto.sha256Hex(input);
      const browserHash = browserCrypto.sha256Hex(input);
      expect(nodeHash).toBe(browserHash);
    });
  });

  describe('HMAC-SHA256', () => {
    it('should compute HMAC correctly', () => {
      const key = new TextEncoder().encode('secret-key');
      const data = new TextEncoder().encode('message to authenticate');
      const hmac = hmacSha256(key, data);

      expect(hmac).toBeInstanceOf(Uint8Array);
      expect(hmac.length).toBe(32);
    });

    it('should produce identical output from Node and browser implementations', () => {
      const key = new TextEncoder().encode('test-key');
      const data = new TextEncoder().encode('test-data');

      const nodeHmac = nodeCrypto.hmacSha256(key, data);
      const browserHmac = browserCrypto.hmacSha256(key, data);

      expect(nodeHmac).toEqual(browserHmac);
    });

    it('should produce different output for different keys', () => {
      const key1 = new TextEncoder().encode('key1');
      const key2 = new TextEncoder().encode('key2');
      const data = new TextEncoder().encode('data');

      const hmac1 = hmacSha256(key1, data);
      const hmac2 = hmacSha256(key2, data);

      expect(hmac1).not.toEqual(hmac2);
    });
  });

  describe('HKDF-SHA256', () => {
    it('should derive key material', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('test-info');

      const derived = hkdfSha256(ikm, salt, info, 32);

      expect(derived).toBeInstanceOf(Uint8Array);
      expect(derived.length).toBe(32);
    });

    it('should produce identical output from Node and browser implementations', () => {
      const ikm = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
      const salt = new Uint8Array([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      const info = new TextEncoder().encode('test');

      const nodeDerived = nodeCrypto.hkdfSha256(ikm, salt, info, 32);
      const browserDerived = browserCrypto.hkdfSha256(ikm, salt, info, 32);

      expect(nodeDerived).toEqual(browserDerived);
    });

    it('should derive different lengths correctly', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('info');

      const derived16 = hkdfSha256(ikm, salt, info, 16);
      const derived64 = hkdfSha256(ikm, salt, info, 64);

      expect(derived16.length).toBe(16);
      expect(derived64.length).toBe(64);
    });

    it('should handle empty salt', () => {
      const ikm = randomBytes(32);
      const salt = new Uint8Array(0);
      const info = new TextEncoder().encode('info');

      const derived = hkdfSha256(ikm, salt, info, 32);
      expect(derived.length).toBe(32);
    });

    it('should throw for zero length', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('info');
      expect(() => hkdfSha256(ikm, salt, info, 0)).toThrow('HKDF length must be a positive integer');
    });

    it('should throw for negative length', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('info');
      expect(() => hkdfSha256(ikm, salt, info, -1)).toThrow('HKDF length must be a positive integer');
    });

    it('should throw for non-integer length', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('info');
      expect(() => hkdfSha256(ikm, salt, info, 32.5)).toThrow('HKDF length must be a positive integer');
    });

    it('should throw for length exceeding HKDF-SHA256 maximum (8160 bytes)', () => {
      const ikm = randomBytes(32);
      const salt = randomBytes(16);
      const info = new TextEncoder().encode('info');
      expect(() => hkdfSha256(ikm, salt, info, 8161)).toThrow('HKDF-SHA256 length cannot exceed 8160 bytes');
    });
  });

  describe('AES-256-GCM Encryption/Decryption', () => {
    it('should encrypt and decrypt correctly', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('Hello, World!');

      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);
      const decrypted = decryptAesGcm(key, ciphertext, iv, tag);

      expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
    });

    it('should produce ciphertext and tag', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('test');

      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);

      expect(ciphertext).toBeInstanceOf(Uint8Array);
      expect(tag).toBeInstanceOf(Uint8Array);
      expect(tag.length).toBe(16); // GCM tag is 16 bytes
    });

    it('should produce different ciphertext with different IVs', () => {
      const key = randomBytes(32);
      const plaintext = new TextEncoder().encode('same message');

      const { ciphertext: ct1 } = encryptAesGcm(key, plaintext, randomBytes(12));
      const { ciphertext: ct2 } = encryptAesGcm(key, plaintext, randomBytes(12));

      expect(ct1).not.toEqual(ct2);
    });

    it('should fail decryption with wrong key', () => {
      const key = randomBytes(32);
      const wrongKey = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('secret');

      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);

      expect(() => decryptAesGcm(wrongKey, ciphertext, iv, tag)).toThrow();
    });

    it('should fail decryption with tampered ciphertext', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('secret');

      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);

      // Tamper with ciphertext
      ciphertext[0] ^= 0xff;

      expect(() => decryptAesGcm(key, ciphertext, iv, tag)).toThrow();
    });

    it('should produce identical output from Node and browser implementations', () => {
      // Use fixed values for reproducibility
      const key = new Uint8Array(32).fill(0x42);
      const iv = new Uint8Array(12).fill(0x24);
      const plaintext = new TextEncoder().encode('Cross-platform encryption test');

      const nodeResult = nodeCrypto.encryptAesGcm(key, plaintext, iv);
      const browserResult = browserCrypto.encryptAesGcm(key, plaintext, iv);

      // Ciphertext and tag should be identical
      expect(nodeResult.ciphertext).toEqual(browserResult.ciphertext);
      expect(nodeResult.tag).toEqual(browserResult.tag);

      // Decryption should work cross-platform
      const nodeDecrypted = nodeCrypto.decryptAesGcm(key, browserResult.ciphertext, iv, browserResult.tag);
      const browserDecrypted = browserCrypto.decryptAesGcm(key, nodeResult.ciphertext, iv, nodeResult.tag);

      expect(new TextDecoder().decode(nodeDecrypted)).toBe('Cross-platform encryption test');
      expect(new TextDecoder().decode(browserDecrypted)).toBe('Cross-platform encryption test');
    });

    // Input validation tests
    it('should throw for wrong key size in encryptAesGcm', () => {
      const wrongKey = randomBytes(16); // Should be 32
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('test');
      expect(() => encryptAesGcm(wrongKey, plaintext, iv)).toThrow('AES-256-GCM requires a 32-byte key');
    });

    it('should throw for wrong IV size in encryptAesGcm', () => {
      const key = randomBytes(32);
      const wrongIv = randomBytes(16); // Should be 12
      const plaintext = new TextEncoder().encode('test');
      expect(() => encryptAesGcm(key, plaintext, wrongIv)).toThrow('AES-GCM requires a 12-byte IV');
    });

    it('should throw for wrong key size in decryptAesGcm', () => {
      const key = randomBytes(32);
      const wrongKey = randomBytes(16);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('test');
      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);
      expect(() => decryptAesGcm(wrongKey, ciphertext, iv, tag)).toThrow('AES-256-GCM requires a 32-byte key');
    });

    it('should throw for wrong IV size in decryptAesGcm', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const wrongIv = randomBytes(16);
      const plaintext = new TextEncoder().encode('test');
      const { ciphertext, tag } = encryptAesGcm(key, plaintext, iv);
      expect(() => decryptAesGcm(key, ciphertext, wrongIv, tag)).toThrow('AES-GCM requires a 12-byte IV');
    });

    it('should throw for wrong tag size in decryptAesGcm', () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode('test');
      const { ciphertext } = encryptAesGcm(key, plaintext, iv);
      const wrongTag = randomBytes(8); // Should be 16
      expect(() => decryptAesGcm(key, ciphertext, iv, wrongTag)).toThrow(
        'AES-GCM requires a 16-byte authentication tag',
      );
    });
  });

  describe('Timing-Safe Comparison', () => {
    it('should return true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('should return false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('should throw for arrays of different lengths', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(() => timingSafeEqual(a, b)).toThrow('timingSafeEqual requires equal-length arrays');
    });

    it('should produce identical results from Node and browser implementations', () => {
      const a = randomBytes(32);
      const b = new Uint8Array(a);
      const c = randomBytes(32);

      expect(nodeCrypto.timingSafeEqual(a, b)).toBe(browserCrypto.timingSafeEqual(a, b));
      expect(nodeCrypto.timingSafeEqual(a, c)).toBe(browserCrypto.timingSafeEqual(a, c));
    });
  });

  describe('Encoding Utilities', () => {
    describe('bytesToHex', () => {
      it('should convert bytes to hex string', () => {
        const bytes = new Uint8Array([0x00, 0x01, 0x0f, 0x10, 0xff]);
        expect(bytesToHex(bytes)).toBe('00010f10ff');
      });

      it('should handle empty array', () => {
        expect(bytesToHex(new Uint8Array([]))).toBe('');
      });

      it('should pad single digits with zero', () => {
        const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        expect(bytesToHex(bytes)).toBe('000102030405060708090a0b0c0d0e0f');
      });
    });

    describe('base64urlEncode', () => {
      it('should encode bytes to base64url', () => {
        const bytes = new TextEncoder().encode('Hello, World!');
        const encoded = base64urlEncode(bytes);
        expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ');
      });

      it('should not include padding', () => {
        const bytes = new TextEncoder().encode('a');
        const encoded = base64urlEncode(bytes);
        expect(encoded).not.toContain('=');
      });

      it('should use URL-safe characters', () => {
        // Create bytes that would produce + and / in standard base64
        const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
        const encoded = base64urlEncode(bytes);
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
      });

      it('should handle empty array', () => {
        expect(base64urlEncode(new Uint8Array([]))).toBe('');
      });
    });

    describe('base64urlDecode', () => {
      it('should decode base64url to bytes', () => {
        const decoded = base64urlDecode('SGVsbG8sIFdvcmxkIQ');
        expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
      });

      it('should handle URL-safe characters', () => {
        // Encode then decode
        const original = new Uint8Array([0xfb, 0xff, 0xfe]);
        const encoded = base64urlEncode(original);
        const decoded = base64urlDecode(encoded);
        expect(decoded).toEqual(original);
      });

      it('should handle empty string', () => {
        expect(base64urlDecode('')).toEqual(new Uint8Array([]));
      });

      it('should roundtrip correctly', () => {
        const original = randomBytes(100);
        const encoded = base64urlEncode(original);
        const decoded = base64urlDecode(encoded);
        expect(decoded).toEqual(original);
      });
    });

    describe('sha256Base64url', () => {
      it('should compute SHA-256 and return as base64url', () => {
        // Known vector: SHA-256 of empty string
        const hash = sha256Base64url('');
        expect(hash).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
      });

      it('should handle string input', () => {
        const hash = sha256Base64url('test');
        expect(typeof hash).toBe('string');
        expect(hash.length).toBeGreaterThan(0);
      });

      it('should handle Uint8Array input', () => {
        const bytes = new TextEncoder().encode('test');
        const hash = sha256Base64url(bytes);
        expect(typeof hash).toBe('string');
      });

      it('should produce same result for string and equivalent Uint8Array', () => {
        const str = 'hello world';
        const bytes = new TextEncoder().encode(str);
        expect(sha256Base64url(str)).toBe(sha256Base64url(bytes));
      });
    });
  });

  describe('Integration: Session-like Encryption', () => {
    it('should support a full session encryption/decryption flow', () => {
      // Simulate session key derivation
      const masterSecret = randomBytes(32);
      const salt = randomBytes(16);
      const sessionInfo = new TextEncoder().encode('session-key-v1');

      // Derive session key using HKDF
      const sessionKey = hkdfSha256(masterSecret, salt, sessionInfo, 32);

      // Create session data
      const sessionData = JSON.stringify({
        userId: randomUUID(),
        expiresAt: Date.now() + 3600000,
        roles: ['user', 'admin'],
      });

      // Encrypt session
      const iv = randomBytes(12);
      const plaintext = new TextEncoder().encode(sessionData);
      const { ciphertext, tag } = encryptAesGcm(sessionKey, plaintext, iv);

      // Later: Decrypt session
      const decrypted = decryptAesGcm(sessionKey, ciphertext, iv, tag);
      const recoveredData = JSON.parse(new TextDecoder().decode(decrypted));

      expect(recoveredData.roles).toEqual(['user', 'admin']);
    });

    it('should support HMAC-based session signing', () => {
      // Simulate session signing
      const signingKey = randomBytes(32);
      const sessionId = randomUUID();
      const sessionData = new TextEncoder().encode(sessionId);

      // Sign session
      const signature = hmacSha256(signingKey, sessionData);

      // Verify session
      const expectedSignature = hmacSha256(signingKey, sessionData);
      expect(timingSafeEqual(signature, expectedSignature)).toBe(true);

      // Tampered session should fail verification
      const tamperedData = new TextEncoder().encode(sessionId + 'x');
      const tamperedSignature = hmacSha256(signingKey, tamperedData);
      expect(timingSafeEqual(signature, tamperedSignature)).toBe(false);
    });
  });
});
