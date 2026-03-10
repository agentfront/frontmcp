/**
 * HMAC Signing Tests
 *
 * Tests for the HMAC signing utilities used for tamper-evident data storage.
 */

import { signData, verifyData, isSignedData, verifyOrParseData } from '../hmac-signing';

describe('HMAC Signing', () => {
  const testSecret = 'test-secret-key-for-hmac-signing';
  const config = { secret: testSecret };

  describe('signData()', () => {
    it('should sign data and return JSON string', () => {
      const data = { userId: '123', role: 'admin' };

      const signed = signData(data, config);

      expect(typeof signed).toBe('string');
      const parsed = JSON.parse(signed);
      expect(parsed.data).toEqual(data);
      expect(parsed.sig).toBeDefined();
      expect(parsed.v).toBe(1);
    });

    it('should sign string data', () => {
      const data = 'simple string';

      const signed = signData(data, config);

      const parsed = JSON.parse(signed);
      expect(parsed.data).toBe(data);
    });

    it('should sign numeric data', () => {
      const data = 42;

      const signed = signData(data, config);

      const parsed = JSON.parse(signed);
      expect(parsed.data).toBe(data);
    });

    it('should sign null data', () => {
      const data = null;

      const signed = signData(data, config);

      const parsed = JSON.parse(signed);
      expect(parsed.data).toBe(null);
    });

    it('should sign array data', () => {
      const data = [1, 2, 3, 'four'];

      const signed = signData(data, config);

      const parsed = JSON.parse(signed);
      expect(parsed.data).toEqual(data);
    });

    it('should sign complex nested data', () => {
      const data = {
        user: {
          id: 1,
          profile: {
            name: 'John',
            settings: { theme: 'dark' },
          },
        },
        metadata: [{ key: 'a' }, { key: 'b' }],
      };

      const signed = signData(data, config);

      const parsed = JSON.parse(signed);
      expect(parsed.data).toEqual(data);
    });

    it('should produce different signatures for different data', () => {
      const signed1 = signData({ key: 'value1' }, config);
      const signed2 = signData({ key: 'value2' }, config);

      const parsed1 = JSON.parse(signed1);
      const parsed2 = JSON.parse(signed2);

      expect(parsed1.sig).not.toBe(parsed2.sig);
    });

    it('should produce different signatures for different secrets', () => {
      const data = { key: 'value' };
      const signed1 = signData(data, { secret: 'secret1' });
      const signed2 = signData(data, { secret: 'secret2' });

      const parsed1 = JSON.parse(signed1);
      const parsed2 = JSON.parse(signed2);

      expect(parsed1.sig).not.toBe(parsed2.sig);
    });

    it('should produce identical signatures for identical data and secret', () => {
      const data = { key: 'value' };
      const signed1 = signData(data, config);
      const signed2 = signData(data, config);

      const parsed1 = JSON.parse(signed1);
      const parsed2 = JSON.parse(signed2);

      expect(parsed1.sig).toBe(parsed2.sig);
    });
  });

  describe('verifyData()', () => {
    it('should verify and return valid signed data', () => {
      const data = { userId: '123', role: 'admin' };
      const signed = signData(data, config);

      const result = verifyData<{ userId: string; role: string }>(signed, config);

      expect(result).toEqual(data);
    });

    it('should return null for tampered data', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      // Tamper with the data
      const parsed = JSON.parse(signed);
      parsed.data.userId = '456';
      const tampered = JSON.stringify(parsed);

      const result = verifyData(tampered, config);

      expect(result).toBeNull();
    });

    it('should return null for tampered signature', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      // Tamper with the signature
      const parsed = JSON.parse(signed);
      parsed.sig = parsed.sig + 'x';
      const tampered = JSON.stringify(parsed);

      const result = verifyData(tampered, config);

      expect(result).toBeNull();
    });

    it('should return null for wrong secret', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      const result = verifyData(signed, { secret: 'wrong-secret' });

      expect(result).toBeNull();
    });

    it('should return null for unsigned data', () => {
      const unsigned = JSON.stringify({ key: 'value' });

      const result = verifyData(unsigned, config);

      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const invalid = 'not valid json {';

      const result = verifyData(invalid, config);

      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = verifyData('', config);

      expect(result).toBeNull();
    });

    it('should return null for non-object parsed value', () => {
      const result = verifyData('"just a string"', config);

      expect(result).toBeNull();
    });

    it('should return null for null parsed value', () => {
      const result = verifyData('null', config);

      expect(result).toBeNull();
    });

    it('should return null for wrong version', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      // Change version
      const parsed = JSON.parse(signed);
      parsed.v = 2;
      const modified = JSON.stringify(parsed);

      const result = verifyData(modified, config);

      expect(result).toBeNull();
    });

    it('should return null for signature length mismatch', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      // Truncate signature
      const parsed = JSON.parse(signed);
      parsed.sig = parsed.sig.slice(0, 10);
      const modified = JSON.stringify(parsed);

      const result = verifyData(modified, config);

      expect(result).toBeNull();
    });

    it('should handle data with special characters', () => {
      const data = { message: 'Hello "world" with <special> & chars!' };
      const signed = signData(data, config);

      const result = verifyData(signed, config);

      expect(result).toEqual(data);
    });

    it('should handle data with unicode', () => {
      const data = { emoji: '...', chinese: '...', arabic: '...' };
      const signed = signData(data, config);

      const result = verifyData(signed, config);

      expect(result).toEqual(data);
    });
  });

  describe('isSignedData()', () => {
    it('should return true for signed data', () => {
      const data = { key: 'value' };
      const signed = signData(data, config);

      expect(isSignedData(signed)).toBe(true);
    });

    it('should return false for unsigned data', () => {
      const unsigned = JSON.stringify({ key: 'value' });

      expect(isSignedData(unsigned)).toBe(false);
    });

    it('should return false for object with only sig', () => {
      const partial = JSON.stringify({ sig: 'xxx' });

      expect(isSignedData(partial)).toBe(false);
    });

    it('should return false for object with only v', () => {
      const partial = JSON.stringify({ v: 1 });

      expect(isSignedData(partial)).toBe(false);
    });

    it('should return true for object with both sig and v', () => {
      const hasBoth = JSON.stringify({ sig: 'xxx', v: 1 });

      expect(isSignedData(hasBoth)).toBe(true);
    });

    it('should return false for invalid JSON', () => {
      expect(isSignedData('not valid json')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isSignedData('')).toBe(false);
    });

    it('should return falsy for null string', () => {
      expect(isSignedData('null')).toBeFalsy();
    });

    it('should return false for array', () => {
      expect(isSignedData('[1, 2, 3]')).toBe(false);
    });

    it('should return false for primitive JSON', () => {
      expect(isSignedData('"string"')).toBe(false);
      expect(isSignedData('123')).toBe(false);
      expect(isSignedData('true')).toBe(false);
    });
  });

  describe('verifyOrParseData()', () => {
    it('should verify and return signed data', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      const result = verifyOrParseData<{ userId: string }>(signed, config);

      expect(result).toEqual(data);
    });

    it('should return null for tampered signed data', () => {
      const data = { userId: '123' };
      const signed = signData(data, config);

      // Tamper with data
      const parsed = JSON.parse(signed);
      parsed.data.userId = '456';
      const tampered = JSON.stringify(parsed);

      const result = verifyOrParseData(tampered, config);

      expect(result).toBeNull();
    });

    it('should parse and return unsigned (legacy) data', () => {
      const legacyData = { userId: '123', legacy: true };
      const unsigned = JSON.stringify(legacyData);

      const result = verifyOrParseData<{ userId: string; legacy: boolean }>(unsigned, config);

      expect(result).toEqual(legacyData);
    });

    it('should return null for invalid unsigned JSON', () => {
      const result = verifyOrParseData('not valid json', config);

      expect(result).toBeNull();
    });

    it('should handle legacy string data', () => {
      const legacyString = '"just a string"';

      const result = verifyOrParseData<string>(legacyString, config);

      expect(result).toBe('just a string');
    });

    it('should handle legacy array data', () => {
      const legacyArray = '[1, 2, 3]';

      const result = verifyOrParseData<number[]>(legacyArray, config);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle legacy null data', () => {
      const legacyNull = 'null';

      const result = verifyOrParseData(legacyNull, config);

      expect(result).toBeNull();
    });
  });

  describe('Integration', () => {
    it('should round-trip complex data through sign/verify', () => {
      const complexData = {
        session: {
          id: 'sess_abc123',
          userId: 'user_456',
          createdAt: 1704067200000,
          expiresAt: 1704153600000,
        },
        permissions: ['read', 'write', 'admin'],
        metadata: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
      };

      const signed = signData(complexData, config);
      const verified = verifyData(signed, config);

      expect(verified).toEqual(complexData);
    });

    it('should detect any tampering in complex data', () => {
      const data = {
        permissions: ['read', 'write'],
      };

      const signed = signData(data, config);
      const parsed = JSON.parse(signed);

      // Subtle tampering: add 'admin' to permissions
      parsed.data.permissions.push('admin');
      const tampered = JSON.stringify(parsed);

      const result = verifyData(tampered, config);

      expect(result).toBeNull();
    });
  });
});
