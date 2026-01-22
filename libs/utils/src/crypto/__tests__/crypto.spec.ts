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

    describe('base64Encode', () => {
      // Import base64Encode and base64Decode
      const { base64Encode, base64Decode } = require('../index');

      it('should encode bytes to standard base64', () => {
        const bytes = new TextEncoder().encode('Hello, World!');
        const encoded = base64Encode(bytes);
        expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
      });

      it('should include padding', () => {
        const bytes = new TextEncoder().encode('a');
        const encoded = base64Encode(bytes);
        expect(encoded).toContain('=');
        expect(encoded).toBe('YQ==');
      });

      it('should use standard base64 characters', () => {
        // Create bytes that would produce + and / in standard base64
        const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
        const encoded = base64Encode(bytes);
        // Should use standard characters (+ and /)
        expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
      });

      it('should handle empty array', () => {
        expect(base64Encode(new Uint8Array([]))).toBe('');
      });
    });

    describe('base64Decode', () => {
      const { base64Encode, base64Decode } = require('../index');

      it('should decode standard base64 to bytes', () => {
        const decoded = base64Decode('SGVsbG8sIFdvcmxkIQ==');
        expect(new TextDecoder().decode(decoded)).toBe('Hello, World!');
      });

      it('should handle standard base64 characters', () => {
        // Encode then decode
        const original = new Uint8Array([0xfb, 0xff, 0xfe]);
        const encoded = base64Encode(original);
        const decoded = base64Decode(encoded);
        expect(decoded).toEqual(original);
      });

      it('should handle empty string', () => {
        expect(base64Decode('')).toEqual(new Uint8Array([]));
      });

      it('should roundtrip correctly', () => {
        const original = randomBytes(100);
        const encoded = base64Encode(original);
        const decoded = base64Decode(encoded);
        expect(decoded).toEqual(original);
      });

      it('should handle base64 without padding', () => {
        // Some base64 implementations omit padding
        const decoded = base64Decode('YQ');
        expect(new TextDecoder().decode(decoded)).toBe('a');
      });
    });
  });

  describe('Re-exported PKCE Functions', () => {
    const {
      generateCodeVerifier,
      generateCodeChallenge,
      generatePkcePair,
      verifyCodeChallenge,
      isValidCodeVerifier,
      isValidCodeChallenge,
      PkceError,
      MIN_CODE_VERIFIER_LENGTH,
      MAX_CODE_VERIFIER_LENGTH,
      DEFAULT_CODE_VERIFIER_LENGTH,
    } = require('../index');

    it('should export PKCE constants', () => {
      expect(MIN_CODE_VERIFIER_LENGTH).toBe(43);
      expect(MAX_CODE_VERIFIER_LENGTH).toBe(128);
      expect(DEFAULT_CODE_VERIFIER_LENGTH).toBe(64);
    });

    it('should export PkceError class', () => {
      expect(PkceError).toBeDefined();
      const error = new PkceError('test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('test error');
    });

    it('should generate valid code verifier', () => {
      const verifier = generateCodeVerifier();
      expect(typeof verifier).toBe('string');
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });

    it('should generate code challenge from verifier', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('should generate PKCE pair', () => {
      const pair = generatePkcePair();
      expect(pair.codeVerifier).toBeDefined();
      expect(pair.codeChallenge).toBeDefined();
    });

    it('should verify code challenge correctly', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      const isValid = verifyCodeChallenge(verifier, challenge);
      expect(isValid).toBe(true);
    });

    it('should validate code verifier', () => {
      const validVerifier = generateCodeVerifier();
      expect(isValidCodeVerifier(validVerifier)).toBe(true);
      expect(isValidCodeVerifier('short')).toBe(false);
    });

    it('should validate code challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);
      expect(isValidCodeChallenge(challenge)).toBe(true);
      expect(isValidCodeChallenge('')).toBe(false);
    });
  });

  describe('Re-exported HMAC Signing Functions', () => {
    const { signData, verifyData, isSignedData, verifyOrParseData } = require('../index');
    const testSecret = 'test-secret-for-crypto-spec';
    const config = { secret: testSecret };

    it('should export signData function', () => {
      expect(typeof signData).toBe('function');
      const signed = signData({ test: 'data' }, config);
      expect(typeof signed).toBe('string');
    });

    it('should export verifyData function', () => {
      expect(typeof verifyData).toBe('function');
      const signed = signData({ test: 'value' }, config);
      const verified = verifyData(signed, config);
      expect(verified).toEqual({ test: 'value' });
    });

    it('should export isSignedData function', () => {
      expect(typeof isSignedData).toBe('function');
      const signed = signData({ test: 'value' }, config);
      expect(isSignedData(signed)).toBe(true);
      expect(isSignedData('{"not":"signed"}')).toBe(false);
    });

    it('should export verifyOrParseData function', () => {
      expect(typeof verifyOrParseData).toBe('function');
      const signed = signData({ test: 'value' }, config);
      expect(verifyOrParseData(signed, config)).toEqual({ test: 'value' });
      expect(verifyOrParseData('{"legacy":"data"}', config)).toEqual({ legacy: 'data' });
    });
  });

  describe('Re-exported Encrypted Blob Functions', () => {
    const {
      encryptValue,
      decryptValue,
      tryDecryptValue,
      serializeBlob,
      deserializeBlob,
      tryDeserializeBlob,
      isValidEncryptedBlob,
      encryptAndSerialize,
      deserializeAndDecrypt,
      tryDeserializeAndDecrypt,
      EncryptedBlobError,
    } = require('../index');

    const testKey = randomBytes(32);

    it('should export EncryptedBlobError', () => {
      expect(EncryptedBlobError).toBeDefined();
      const error = new EncryptedBlobError('test');
      expect(error).toBeInstanceOf(Error);
    });

    it('should encrypt and decrypt values', () => {
      const value = 'test-value';
      const blob = encryptValue(value, testKey);
      const decrypted = decryptValue(blob, testKey);
      expect(decrypted).toBe(value);
    });

    it('should try decrypt and return null on failure', () => {
      const blob = encryptValue('test', testKey);
      const wrongKey = randomBytes(32);
      const result = tryDecryptValue(blob, wrongKey);
      expect(result).toBeNull();
    });

    it('should serialize and deserialize blobs', () => {
      const blob = encryptValue('test', testKey);
      const serialized = serializeBlob(blob);
      expect(typeof serialized).toBe('string');
      const deserialized = deserializeBlob(serialized);
      expect(deserialized).toEqual(blob);
    });

    it('should try deserialize and return null on invalid input', () => {
      expect(tryDeserializeBlob('invalid')).toBeNull();
    });

    it('should validate encrypted blobs', () => {
      const blob = encryptValue('test', testKey);
      expect(isValidEncryptedBlob(blob)).toBe(true);
      expect(isValidEncryptedBlob({})).toBe(false);
    });

    it('should encrypt and serialize in one step', () => {
      const serialized = encryptAndSerialize('test', testKey);
      expect(typeof serialized).toBe('string');
    });

    it('should deserialize and decrypt in one step', () => {
      const serialized = encryptAndSerialize('test-value', testKey);
      const decrypted = deserializeAndDecrypt(serialized, testKey);
      expect(decrypted).toBe('test-value');
    });

    it('should try deserialize and decrypt returning null on failure', () => {
      const result = tryDeserializeAndDecrypt('invalid', testKey);
      expect(result).toBeNull();
    });
  });

  describe('Re-exported Secret Persistence Functions', () => {
    const {
      secretDataSchema,
      validateSecretData,
      parseSecretData,
      isSecretPersistenceEnabled,
      generateSecret,
      createSecretData,
    } = require('../index');

    it('should export secretDataSchema', () => {
      expect(secretDataSchema).toBeDefined();
      expect(typeof secretDataSchema.safeParse).toBe('function');
    });

    it('should validate secret data', () => {
      // Generate a valid base64url secret (32 bytes = 43 chars in base64url)
      const validSecret = generateSecret(32);
      const result = validateSecretData({
        secret: validSecret,
        createdAt: Date.now(),
        version: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid secret data', () => {
      const result = validateSecretData({
        secret: 'short',
        createdAt: Date.now(),
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should parse valid secret data', () => {
      const validSecret = generateSecret(32);
      const data = {
        secret: validSecret,
        createdAt: Date.now(),
        version: 1,
      };
      const parsed = parseSecretData(data);
      expect(parsed).toEqual(data);
    });

    it('should return null for invalid secret data', () => {
      const parsed = parseSecretData({ invalid: 'data' });
      expect(parsed).toBeNull();
    });

    it('should check if secret persistence is enabled', () => {
      const result = isSecretPersistenceEnabled();
      expect(typeof result).toBe('boolean');
    });

    it('should generate secrets', () => {
      const secret = generateSecret(32);
      expect(typeof secret).toBe('string');
      expect(secret.length).toBe(43); // base64url of 32 bytes is 43 chars
    });

    it('should create secret data with default options', () => {
      const data = createSecretData();
      expect(data.secret).toBeDefined();
      expect(typeof data.secret).toBe('string');
      expect(data.createdAt).toBeDefined();
      expect(data.version).toBe(1);
    });

    it('should create secret data with custom bytes', () => {
      const data = createSecretData({ secretBytes: 64 });
      expect(data.secret).toBeDefined();
      expect(data.secret.length).toBe(86); // base64url of 64 bytes is 86 chars
    });
  });

  describe('Re-exported Key Persistence Functions', () => {
    const {
      validateKeyData,
      parseKeyData,
      isSecretKeyData,
      isAsymmetricKeyData,
      KeyPersistence,
      createKeyPersistence,
    } = require('../index');

    it('should export validateKeyData function', () => {
      expect(typeof validateKeyData).toBe('function');
    });

    it('should export parseKeyData function', () => {
      expect(typeof parseKeyData).toBe('function');
    });

    it('should export isSecretKeyData function', () => {
      expect(typeof isSecretKeyData).toBe('function');
      expect(isSecretKeyData({ type: 'secret' })).toBe(true);
      expect(isSecretKeyData({ type: 'asymmetric' })).toBe(false);
    });

    it('should export isAsymmetricKeyData function', () => {
      expect(typeof isAsymmetricKeyData).toBe('function');
      expect(isAsymmetricKeyData({ type: 'asymmetric' })).toBe(true);
      expect(isAsymmetricKeyData({ type: 'secret' })).toBe(false);
    });

    it('should export KeyPersistence class', () => {
      expect(KeyPersistence).toBeDefined();
      expect(typeof KeyPersistence).toBe('function');
    });

    it('should export createKeyPersistence factory', () => {
      expect(typeof createKeyPersistence).toBe('function');
    });
  });

  describe('Runtime Utilities', () => {
    const { assertNode } = require('../index');

    it('should export assertNode function', () => {
      expect(typeof assertNode).toBe('function');
    });

    it('should not throw in Node.js environment', () => {
      expect(() => assertNode('testOperation')).not.toThrow();
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

  describe('RSA Key Utilities (Node.js)', () => {
    // Import Node.js specific utilities
    const {
      generateRsaKeyPair,
      rsaSign,
      rsaVerify,
      createSignedJwt,
      jwtAlgToNodeAlg,
      isRsaPssAlg,
    } = require('../node');
    const crypto = require('node:crypto');

    describe('generateRsaKeyPair()', () => {
      it('should generate RSA key pair with default modulus length', () => {
        const keyPair = generateRsaKeyPair();

        expect(keyPair.privateKey).toBeDefined();
        expect(keyPair.publicKey).toBeDefined();
        expect(keyPair.publicJwk).toBeDefined();
      });

      it('should generate RSA key pair with custom modulus length', () => {
        const keyPair = generateRsaKeyPair(3072);

        expect(keyPair.privateKey).toBeDefined();
        expect(keyPair.publicKey).toBeDefined();
      });

      it('should generate valid JWK', () => {
        const keyPair = generateRsaKeyPair(2048, 'RS256');

        expect(keyPair.publicJwk.kty).toBe('RSA');
        expect(keyPair.publicJwk.alg).toBe('RS256');
        expect(keyPair.publicJwk.use).toBe('sig');
        expect(keyPair.publicJwk.n).toBeDefined();
        expect(keyPair.publicJwk.e).toBeDefined();
        expect(keyPair.publicJwk.kid).toMatch(/^rsa-key-/);
      });

      it('should generate unique key IDs', () => {
        const keyPair1 = generateRsaKeyPair();
        const keyPair2 = generateRsaKeyPair();

        expect(keyPair1.publicJwk.kid).not.toBe(keyPair2.publicJwk.kid);
      });

      it('should support PS256 algorithm', () => {
        const keyPair = generateRsaKeyPair(2048, 'PS256');

        expect(keyPair.publicJwk.alg).toBe('PS256');
      });
    });

    describe('rsaSign() and rsaVerify()', () => {
      describe('RS256 (RSASSA-PKCS1-v1_5)', () => {
        it('should sign and verify data with RS256', () => {
          const keyPair = generateRsaKeyPair(2048, 'RS256');
          const data = Buffer.from('Hello, World!');

          const signature = rsaSign('RSA-SHA256', data, keyPair.privateKey);

          expect(signature).toBeInstanceOf(Buffer);
          expect(signature.length).toBeGreaterThan(0);

          // Verify using rsaVerify
          const isValid = rsaVerify('RS256', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });

        it('should fail verification with wrong data', () => {
          const keyPair = generateRsaKeyPair(2048, 'RS256');
          const data = Buffer.from('Original data');
          const wrongData = Buffer.from('Tampered data');

          const signature = rsaSign('RSA-SHA256', data, keyPair.privateKey);

          const isValid = rsaVerify('RS256', wrongData, keyPair.publicJwk, signature);
          expect(isValid).toBe(false);
        });

        it('should fail verification with wrong key', () => {
          const keyPair1 = generateRsaKeyPair(2048, 'RS256');
          const keyPair2 = generateRsaKeyPair(2048, 'RS256');
          const data = Buffer.from('Hello, World!');

          const signature = rsaSign('RSA-SHA256', data, keyPair1.privateKey);

          const isValid = rsaVerify('RS256', data, keyPair2.publicJwk, signature);
          expect(isValid).toBe(false);
        });
      });

      describe('RS384', () => {
        it('should sign and verify data with RS384', () => {
          const keyPair = generateRsaKeyPair(2048, 'RS384');
          const data = Buffer.from('Test data for RS384');

          const signature = rsaSign('RSA-SHA384', data, keyPair.privateKey);

          const isValid = rsaVerify('RS384', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });
      });

      describe('RS512', () => {
        it('should sign and verify data with RS512', () => {
          const keyPair = generateRsaKeyPair(2048, 'RS512');
          const data = Buffer.from('Test data for RS512');

          const signature = rsaSign('RSA-SHA512', data, keyPair.privateKey);

          const isValid = rsaVerify('RS512', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });
      });

      describe('PS256 (RSASSA-PSS)', () => {
        it('should sign and verify data with PS256', () => {
          const keyPair = generateRsaKeyPair(2048, 'PS256');
          const data = Buffer.from('Test data for PS256');

          const signature = rsaSign('RSA-SHA256', data, keyPair.privateKey, {
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          });

          const isValid = rsaVerify('PS256', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });
      });

      describe('PS384', () => {
        it('should sign and verify data with PS384', () => {
          const keyPair = generateRsaKeyPair(2048, 'PS384');
          const data = Buffer.from('Test data for PS384');

          const signature = rsaSign('RSA-SHA384', data, keyPair.privateKey, {
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          });

          const isValid = rsaVerify('PS384', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });
      });

      describe('PS512', () => {
        it('should sign and verify data with PS512', () => {
          const keyPair = generateRsaKeyPair(2048, 'PS512');
          const data = Buffer.from('Test data for PS512');

          const signature = rsaSign('RSA-SHA512', data, keyPair.privateKey, {
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
          });

          const isValid = rsaVerify('PS512', data, keyPair.publicJwk, signature);
          expect(isValid).toBe(true);
        });
      });
    });

    describe('createSignedJwt()', () => {
      it('should create a valid RS256 JWT', () => {
        const keyPair = generateRsaKeyPair(2048, 'RS256');
        const payload = {
          sub: 'user123',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        };

        const jwt = createSignedJwt(payload, keyPair.privateKey, keyPair.publicJwk.kid, 'RS256');

        expect(typeof jwt).toBe('string');
        const parts = jwt.split('.');
        expect(parts.length).toBe(3);

        // Verify header
        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        expect(header.alg).toBe('RS256');
        expect(header.typ).toBe('JWT');
        expect(header.kid).toBe(keyPair.publicJwk.kid);

        // Verify payload
        const decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        expect(decodedPayload.sub).toBe('user123');
      });

      it('should create a valid PS256 JWT', () => {
        const keyPair = generateRsaKeyPair(2048, 'PS256');
        const payload = { sub: 'user456' };

        const jwt = createSignedJwt(payload, keyPair.privateKey, keyPair.publicJwk.kid, 'PS256');

        const parts = jwt.split('.');
        expect(parts.length).toBe(3);

        const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
        expect(header.alg).toBe('PS256');
      });

      it('should create JWT with default RS256 algorithm', () => {
        const keyPair = generateRsaKeyPair();
        const payload = { test: 'data' };

        const jwt = createSignedJwt(payload, keyPair.privateKey, keyPair.publicJwk.kid);

        const header = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString());
        expect(header.alg).toBe('RS256');
      });

      it('should create verifiable JWT', () => {
        const keyPair = generateRsaKeyPair(2048, 'RS256');
        const payload = { sub: 'test', data: 'value' };

        const jwt = createSignedJwt(payload, keyPair.privateKey, keyPair.publicJwk.kid, 'RS256');

        const [headerB64, payloadB64, signatureB64] = jwt.split('.');
        const signatureInput = Buffer.from(`${headerB64}.${payloadB64}`);
        const signature = Buffer.from(signatureB64, 'base64url');

        const isValid = rsaVerify('RS256', signatureInput, keyPair.publicJwk, signature);
        expect(isValid).toBe(true);
      });

      it('should handle complex payload objects', () => {
        const keyPair = generateRsaKeyPair();
        const payload = {
          iss: 'https://issuer.example.com',
          sub: 'user@example.com',
          aud: ['api.example.com', 'web.example.com'],
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          nbf: Math.floor(Date.now() / 1000),
          custom: {
            roles: ['admin', 'user'],
            permissions: ['read', 'write'],
          },
        };

        const jwt = createSignedJwt(payload, keyPair.privateKey, keyPair.publicJwk.kid);

        const decodedPayload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
        expect(decodedPayload.iss).toBe(payload.iss);
        expect(decodedPayload.aud).toEqual(payload.aud);
        expect(decodedPayload.custom.roles).toEqual(['admin', 'user']);
      });
    });

    describe('jwtAlgToNodeAlg() and isRsaPssAlg() re-exports', () => {
      it('should export jwtAlgToNodeAlg from node module', () => {
        expect(jwtAlgToNodeAlg('RS256')).toBe('RSA-SHA256');
        expect(jwtAlgToNodeAlg('PS256')).toBe('RSA-SHA256');
      });

      it('should export isRsaPssAlg from node module', () => {
        expect(isRsaPssAlg('RS256')).toBe(false);
        expect(isRsaPssAlg('PS256')).toBe(true);
      });
    });
  });
});
