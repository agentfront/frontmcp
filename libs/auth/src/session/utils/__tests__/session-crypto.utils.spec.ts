/**
 * Session Crypto Utils Tests
 */

// We need to mock dependencies before imports
const mockGetMachineId = jest.fn(() => 'test-machine-id-12345');

jest.mock('../../../machine-id/machine-id', () => ({
  getMachineId: mockGetMachineId,
}));

// Mock @frontmcp/utils with real-ish crypto implementations
jest.mock('@frontmcp/utils', () => {
  const crypto = require('crypto');
  return {
    sha256: (data: Uint8Array) => {
      const hash = crypto.createHash('sha256').update(data);
      return new Uint8Array(hash.digest());
    },
    encryptValue: jest.fn((obj: unknown, key: Uint8Array) => {
      // Simplified AES-256-GCM encryption for testing
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
      const plaintext = JSON.stringify(obj);
      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const tag = cipher.getAuthTag();
      return {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted,
      };
    }),
    decryptValue: jest.fn((envelope: { iv: string; tag: string; data: string; alg: string }, key: Uint8Array) => {
      const iv = Buffer.from(envelope.iv, 'base64');
      const tag = Buffer.from(envelope.tag, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(envelope.data, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      return JSON.parse(decrypted);
    }),
    // Required by AuthInternalError base class for errorId generation
    randomBytes: (n: number) => crypto.randomBytes(n),
    bytesToHex: (bytes: Uint8Array) => Buffer.from(bytes).toString('hex'),
  };
});

import { getKey, encryptJson, decryptSessionJson, safeDecrypt, resetCachedKey } from '../session-crypto.utils';

import { SessionSecretRequiredError } from '../../../errors/auth-internal.errors';

describe('session-crypto.utils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['MCP_SESSION_SECRET'];
    delete process.env['NODE_ENV'];
    resetCachedKey();
    mockGetMachineId.mockReturnValue('test-machine-id-12345');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ------------------------------------------
  // getKey
  // ------------------------------------------
  describe('getKey', () => {
    it('should return a Uint8Array of 32 bytes', () => {
      const key = getKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should use MCP_SESSION_SECRET when available', () => {
      process.env['MCP_SESSION_SECRET'] = 'my-secret-value';
      const key = getKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should fall back to getMachineId() in non-production', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const key = getKey();
      expect(key).toBeInstanceOf(Uint8Array);
      expect(mockGetMachineId).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should throw SessionSecretRequiredError in production without secret', () => {
      process.env['NODE_ENV'] = 'production';
      expect(() => getKey()).toThrow(SessionSecretRequiredError);
    });

    it('should not throw in production when secret is set', () => {
      process.env['NODE_ENV'] = 'production';
      process.env['MCP_SESSION_SECRET'] = 'prod-secret';
      expect(() => getKey()).not.toThrow();
    });

    it('should cache the key on subsequent calls', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const key1 = getKey();
      const key2 = getKey();
      expect(key1).toBe(key2); // Same object reference
      warnSpy.mockRestore();
    });

    it('should produce different keys for different secrets', () => {
      process.env['MCP_SESSION_SECRET'] = 'secret-a';
      const keyA = getKey();
      resetCachedKey();
      process.env['MCP_SESSION_SECRET'] = 'secret-b';
      const keyB = getKey();
      expect(Buffer.from(keyA).equals(Buffer.from(keyB))).toBe(false);
    });

    it('should warn when falling back to machine ID', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      getKey();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NOT SECURE FOR PRODUCTION'));
      warnSpy.mockRestore();
    });
  });

  // ------------------------------------------
  // resetCachedKey
  // ------------------------------------------
  describe('resetCachedKey', () => {
    it('should clear the cached key', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const key1 = getKey();
      resetCachedKey();

      // After reset, getMachineId is called again on next getKey()
      mockGetMachineId.mockReturnValue('different-machine-id');
      const key2 = getKey();

      // Keys derived from different machine IDs should differ
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
      warnSpy.mockRestore();
    });
  });

  // ------------------------------------------
  // encryptJson / decryptSessionJson round-trip
  // ------------------------------------------
  describe('encryptJson / decryptSessionJson', () => {
    it('should round-trip a simple object', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const original = { nodeId: 'abc', authSig: 'sig123', uuid: 'uuid-1', iat: 1234567890 };
      const encrypted = encryptJson(original);
      const decrypted = decryptSessionJson(encrypted);
      expect(decrypted).toEqual(original);
      warnSpy.mockRestore();
    });

    it('should produce iv.tag.ct format', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const encrypted = encryptJson({ test: true });
      const parts = encrypted.split('.');
      expect(parts.length).toBe(3);
      parts.forEach((part) => expect(part.length).toBeGreaterThan(0));
      warnSpy.mockRestore();
    });

    it('should produce different ciphertext for same input (random IV)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const obj = { data: 'same' };
      const e1 = encryptJson(obj);
      const e2 = encryptJson(obj);
      expect(e1).not.toBe(e2);
      warnSpy.mockRestore();
    });

    it('should round-trip a nested object', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const original = {
        user: { sub: 'user-1', roles: ['admin', 'user'] },
        metadata: { count: 42 },
      };
      const encrypted = encryptJson(original);
      const decrypted = decryptSessionJson(encrypted);
      expect(decrypted).toEqual(original);
      warnSpy.mockRestore();
    });
  });

  // ------------------------------------------
  // decryptSessionJson edge cases
  // ------------------------------------------
  describe('decryptSessionJson', () => {
    it('should return null for bad format (not 3 parts)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      expect(decryptSessionJson('only-one-part')).toBeNull();
      expect(decryptSessionJson('two.parts')).toBeNull();
      expect(decryptSessionJson('four.parts.here.extra')).toBeNull();
      warnSpy.mockRestore();
    });

    it('should return null for empty parts', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      expect(decryptSessionJson('..')).toBeNull();
      expect(decryptSessionJson('a..')).toBeNull();
      expect(decryptSessionJson('.b.')).toBeNull();
      expect(decryptSessionJson('..c')).toBeNull();
      warnSpy.mockRestore();
    });
  });

  // ------------------------------------------
  // safeDecrypt
  // ------------------------------------------
  describe('safeDecrypt', () => {
    it('should return decrypted value for valid input', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const encrypted = encryptJson({ hello: 'world' });
      const result = safeDecrypt(encrypted);
      expect(result).toEqual({ hello: 'world' });
      warnSpy.mockRestore();
    });

    it('should return null for invalid ciphertext', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = safeDecrypt('invalid.cipher.text');
      expect(result).toBeNull();
      warnSpy.mockRestore();
    });

    it('should return null for garbled input', () => {
      expect(safeDecrypt('not-valid')).toBeNull();
    });

    it('should not throw for any input', () => {
      expect(() => safeDecrypt('')).not.toThrow();
      expect(() => safeDecrypt('a.b.c')).not.toThrow();
      expect(() => safeDecrypt('random-gibberish-value')).not.toThrow();
    });
  });
});
