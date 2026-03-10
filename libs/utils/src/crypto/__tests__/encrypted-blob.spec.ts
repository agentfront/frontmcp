import {
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
  randomBytes,
  type EncryptedBlob,
} from '../index';

describe('Encrypted Blob Helpers', () => {
  // Generate a valid 32-byte key for tests
  const validKey = randomBytes(32);

  describe('encryptValue', () => {
    it('should encrypt a simple object', () => {
      const data = { message: 'hello', count: 42 };
      const blob = encryptValue(data, validKey);

      expect(blob.alg).toBe('A256GCM');
      expect(typeof blob.iv).toBe('string');
      expect(typeof blob.tag).toBe('string');
      expect(typeof blob.data).toBe('string');
      // Base64url strings should be non-empty
      expect(blob.iv.length).toBeGreaterThan(0);
      expect(blob.tag.length).toBeGreaterThan(0);
      expect(blob.data.length).toBeGreaterThan(0);
    });

    it('should encrypt primitive values', () => {
      expect(encryptValue('string', validKey).alg).toBe('A256GCM');
      expect(encryptValue(123, validKey).alg).toBe('A256GCM');
      expect(encryptValue(true, validKey).alg).toBe('A256GCM');
      expect(encryptValue(null, validKey).alg).toBe('A256GCM');
    });

    it('should encrypt arrays', () => {
      const data = [1, 2, 3, 'four', { five: 5 }];
      const blob = encryptValue(data, validKey);
      expect(blob.alg).toBe('A256GCM');
    });

    it('should throw for invalid key length', () => {
      const shortKey = randomBytes(16);
      expect(() => encryptValue({ test: true }, shortKey)).toThrow(EncryptedBlobError);
      expect(() => encryptValue({ test: true }, shortKey)).toThrow('must be 32 bytes');
    });

    it('should throw for non-serializable data', () => {
      const circular: Record<string, unknown> = { a: 1 };
      circular['self'] = circular;
      expect(() => encryptValue(circular, validKey)).toThrow(EncryptedBlobError);
      expect(() => encryptValue(circular, validKey)).toThrow('Failed to serialize');
    });

    it('should produce different ciphertext for same plaintext (random IV)', () => {
      const data = { test: 'same data' };
      const blob1 = encryptValue(data, validKey);
      const blob2 = encryptValue(data, validKey);

      // IVs should be different
      expect(blob1.iv).not.toBe(blob2.iv);
      // Ciphertext should be different (due to different IVs)
      expect(blob1.data).not.toBe(blob2.data);
    });
  });

  describe('decryptValue', () => {
    it('should decrypt to original data', () => {
      const original = { message: 'secret', nested: { value: 123 } };
      const blob = encryptValue(original, validKey);
      const decrypted = decryptValue<typeof original>(blob, validKey);

      expect(decrypted).toEqual(original);
    });

    it('should decrypt primitive values', () => {
      expect(decryptValue(encryptValue('hello', validKey), validKey)).toBe('hello');
      expect(decryptValue(encryptValue(42, validKey), validKey)).toBe(42);
      expect(decryptValue(encryptValue(true, validKey), validKey)).toBe(true);
      expect(decryptValue(encryptValue(null, validKey), validKey)).toBe(null);
    });

    it('should decrypt arrays', () => {
      const original = [1, 'two', { three: 3 }];
      const decrypted = decryptValue(encryptValue(original, validKey), validKey);
      expect(decrypted).toEqual(original);
    });

    it('should throw for invalid key length', () => {
      const blob = encryptValue({ test: true }, validKey);
      const wrongKey = randomBytes(16);
      expect(() => decryptValue(blob, wrongKey)).toThrow(EncryptedBlobError);
    });

    it('should throw for wrong key', () => {
      const blob = encryptValue({ secret: 'data' }, validKey);
      const differentKey = randomBytes(32);
      expect(() => decryptValue(blob, differentKey)).toThrow(EncryptedBlobError);
      expect(() => decryptValue(blob, differentKey)).toThrow('Decryption failed');
    });

    it('should throw for invalid algorithm', () => {
      const blob: EncryptedBlob = {
        alg: 'A256GCM',
        iv: 'abc',
        tag: 'def',
        data: 'ghi',
      };
      // Modify alg to invalid value
      const invalidBlob = { ...blob, alg: 'INVALID' as 'A256GCM' };
      expect(() => decryptValue(invalidBlob, validKey)).toThrow('Unsupported algorithm');
    });

    it('should throw for corrupted data', () => {
      const blob = encryptValue({ test: true }, validKey);
      const corrupted = { ...blob, data: 'corrupted_data_here' };
      expect(() => decryptValue(corrupted, validKey)).toThrow(EncryptedBlobError);
    });

    it('should throw for corrupted tag', () => {
      const blob = encryptValue({ test: true }, validKey);
      const corrupted = { ...blob, tag: 'wrong_tag' };
      expect(() => decryptValue(corrupted, validKey)).toThrow(EncryptedBlobError);
    });
  });

  describe('tryDecryptValue', () => {
    it('should return decrypted value on success', () => {
      const original = { secret: 'data' };
      const blob = encryptValue(original, validKey);
      const result = tryDecryptValue<typeof original>(blob, validKey);

      expect(result).toEqual(original);
    });

    it('should return null on wrong key', () => {
      const blob = encryptValue({ test: true }, validKey);
      const wrongKey = randomBytes(32);
      expect(tryDecryptValue(blob, wrongKey)).toBeNull();
    });

    it('should return null on corrupted blob', () => {
      const blob = encryptValue({ test: true }, validKey);
      const corrupted = { ...blob, data: 'corrupted' };
      expect(tryDecryptValue(corrupted, validKey)).toBeNull();
    });

    it('should return null for invalid key length', () => {
      const blob = encryptValue({ test: true }, validKey);
      expect(tryDecryptValue(blob, randomBytes(16))).toBeNull();
    });
  });

  describe('serializeBlob', () => {
    it('should serialize blob to JSON string', () => {
      const blob = encryptValue({ test: true }, validKey);
      const serialized = serializeBlob(blob);

      expect(typeof serialized).toBe('string');
      const parsed = JSON.parse(serialized);
      expect(parsed.alg).toBe('A256GCM');
      expect(parsed.iv).toBe(blob.iv);
      expect(parsed.tag).toBe(blob.tag);
      expect(parsed.data).toBe(blob.data);
    });
  });

  describe('deserializeBlob', () => {
    it('should deserialize valid JSON to blob', () => {
      const original = encryptValue({ test: true }, validKey);
      const serialized = serializeBlob(original);
      const deserialized = deserializeBlob(serialized);

      expect(deserialized).toEqual(original);
    });

    it('should throw for invalid JSON', () => {
      expect(() => deserializeBlob('not json')).toThrow(EncryptedBlobError);
      expect(() => deserializeBlob('not json')).toThrow('Failed to parse');
    });

    it('should throw for invalid blob structure', () => {
      expect(() => deserializeBlob('{}')).toThrow(EncryptedBlobError);
      expect(() => deserializeBlob('{}')).toThrow('Invalid encrypted blob');
    });

    it('should throw for missing fields', () => {
      expect(() => deserializeBlob('{"alg":"A256GCM"}')).toThrow('Invalid encrypted blob');
      expect(() => deserializeBlob('{"alg":"A256GCM","iv":"a"}')).toThrow('Invalid encrypted blob');
    });

    it('should throw for wrong algorithm', () => {
      const blob = '{"alg":"OTHER","iv":"a","tag":"b","data":"c"}';
      expect(() => deserializeBlob(blob)).toThrow('Invalid encrypted blob');
    });
  });

  describe('tryDeserializeBlob', () => {
    it('should return blob on success', () => {
      const original = encryptValue({ test: true }, validKey);
      const serialized = serializeBlob(original);
      const result = tryDeserializeBlob(serialized);

      expect(result).toEqual(original);
    });

    it('should return null for invalid JSON', () => {
      expect(tryDeserializeBlob('not json')).toBeNull();
    });

    it('should return null for invalid structure', () => {
      expect(tryDeserializeBlob('{}')).toBeNull();
    });
  });

  describe('isValidEncryptedBlob', () => {
    it('should return true for valid blob', () => {
      const blob = encryptValue({ test: true }, validKey);
      expect(isValidEncryptedBlob(blob)).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidEncryptedBlob(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidEncryptedBlob(undefined)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidEncryptedBlob('string')).toBe(false);
      expect(isValidEncryptedBlob(123)).toBe(false);
    });

    it('should return false for missing fields', () => {
      expect(isValidEncryptedBlob({ alg: 'A256GCM' })).toBe(false);
      expect(isValidEncryptedBlob({ alg: 'A256GCM', iv: 'a' })).toBe(false);
      expect(isValidEncryptedBlob({ alg: 'A256GCM', iv: 'a', tag: 'b' })).toBe(false);
    });

    it('should return false for wrong algorithm', () => {
      expect(isValidEncryptedBlob({ alg: 'OTHER', iv: 'a', tag: 'b', data: 'c' })).toBe(false);
    });

    it('should return false for non-string fields', () => {
      expect(isValidEncryptedBlob({ alg: 'A256GCM', iv: 123, tag: 'b', data: 'c' })).toBe(false);
      expect(isValidEncryptedBlob({ alg: 'A256GCM', iv: 'a', tag: 456, data: 'c' })).toBe(false);
      expect(isValidEncryptedBlob({ alg: 'A256GCM', iv: 'a', tag: 'b', data: null })).toBe(false);
    });
  });

  describe('encryptAndSerialize', () => {
    it('should encrypt and serialize in one step', () => {
      const data = { message: 'hello' };
      const result = encryptAndSerialize(data, validKey);

      expect(typeof result).toBe('string');
      // Should be valid JSON
      const parsed = JSON.parse(result);
      expect(parsed.alg).toBe('A256GCM');
    });

    it('should produce result that can be deserialized and decrypted', () => {
      const original = { nested: { value: 42 } };
      const serialized = encryptAndSerialize(original, validKey);
      const blob = deserializeBlob(serialized);
      const decrypted = decryptValue(blob, validKey);

      expect(decrypted).toEqual(original);
    });
  });

  describe('deserializeAndDecrypt', () => {
    it('should deserialize and decrypt in one step', () => {
      const original = { secret: 'data', count: 123 };
      const serialized = encryptAndSerialize(original, validKey);
      const result = deserializeAndDecrypt<typeof original>(serialized, validKey);

      expect(result).toEqual(original);
    });

    it('should throw for invalid JSON', () => {
      expect(() => deserializeAndDecrypt('not json', validKey)).toThrow(EncryptedBlobError);
    });

    it('should throw for wrong key', () => {
      const serialized = encryptAndSerialize({ test: true }, validKey);
      const wrongKey = randomBytes(32);
      expect(() => deserializeAndDecrypt(serialized, wrongKey)).toThrow(EncryptedBlobError);
    });
  });

  describe('tryDeserializeAndDecrypt', () => {
    it('should return decrypted value on success', () => {
      const original = { test: 'value' };
      const serialized = encryptAndSerialize(original, validKey);
      const result = tryDeserializeAndDecrypt<typeof original>(serialized, validKey);

      expect(result).toEqual(original);
    });

    it('should return null for invalid JSON', () => {
      expect(tryDeserializeAndDecrypt('not json', validKey)).toBeNull();
    });

    it('should return null for wrong key', () => {
      const serialized = encryptAndSerialize({ test: true }, validKey);
      expect(tryDeserializeAndDecrypt(serialized, randomBytes(32))).toBeNull();
    });

    it('should return null for corrupted data', () => {
      const blob = encryptValue({ test: true }, validKey);
      const corrupted = { ...blob, data: 'corrupted' };
      const serialized = JSON.stringify(corrupted);
      expect(tryDeserializeAndDecrypt(serialized, validKey)).toBeNull();
    });
  });

  describe('round-trip scenarios', () => {
    it('should handle complex nested objects', () => {
      const original = {
        users: [
          { id: 1, name: 'Alice', metadata: { role: 'admin' } },
          { id: 2, name: 'Bob', metadata: { role: 'user' } },
        ],
        settings: {
          theme: 'dark',
          notifications: true,
          nested: {
            deep: {
              value: 'found',
            },
          },
        },
      };

      const encrypted = encryptAndSerialize(original, validKey);
      const decrypted = deserializeAndDecrypt<typeof original>(encrypted, validKey);

      expect(decrypted).toEqual(original);
    });

    it('should handle unicode strings', () => {
      const original = {
        emoji: '🔐🔑',
        chinese: '加密',
        arabic: 'تشفير',
        math: '∑∏∫',
      };

      const encrypted = encryptAndSerialize(original, validKey);
      const decrypted = deserializeAndDecrypt<typeof original>(encrypted, validKey);

      expect(decrypted).toEqual(original);
    });

    it('should handle large data', () => {
      const original = {
        largeArray: Array(1000).fill('item'),
        largeString: 'x'.repeat(10000),
      };

      const encrypted = encryptAndSerialize(original, validKey);
      const decrypted = deserializeAndDecrypt<typeof original>(encrypted, validKey);

      expect(decrypted).toEqual(original);
    });

    it('should handle special JSON values', () => {
      const original = {
        nullValue: null,
        emptyString: '',
        emptyArray: [],
        emptyObject: {},
        zero: 0,
        negativeZero: -0, // Note: -0 becomes 0 in JSON
        maxInt: Number.MAX_SAFE_INTEGER,
        minInt: Number.MIN_SAFE_INTEGER,
      };

      const encrypted = encryptAndSerialize(original, validKey);
      const decrypted = deserializeAndDecrypt<typeof original>(encrypted, validKey);

      expect(decrypted.nullValue).toBeNull();
      expect(decrypted.emptyString).toBe('');
      expect(decrypted.emptyArray).toEqual([]);
      expect(decrypted.emptyObject).toEqual({});
      expect(decrypted.zero).toBe(0);
      expect(decrypted.maxInt).toBe(Number.MAX_SAFE_INTEGER);
      expect(decrypted.minInt).toBe(Number.MIN_SAFE_INTEGER);
    });
  });

  describe('EncryptedBlobError', () => {
    it('should have correct name', () => {
      const error = new EncryptedBlobError('test message');
      expect(error.name).toBe('EncryptedBlobError');
    });

    it('should have correct message', () => {
      const error = new EncryptedBlobError('test message');
      expect(error.message).toBe('test message');
    });

    it('should be instance of Error', () => {
      const error = new EncryptedBlobError('test');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
