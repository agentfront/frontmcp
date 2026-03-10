import {
  deriveEncryptionKey,
  encryptValue,
  decryptValue,
  getKeySourceForScope,
  serializeBlob,
  deserializeBlob,
  encryptAndSerialize,
  deserializeAndDecrypt,
  type EncryptedBlob,
  type EncryptionKeySource,
} from '../remember.crypto';
import { clearCachedSecret } from '../remember.secret-persistence';

describe('remember.crypto', () => {
  // Clear cached secret between tests to ensure isolation
  beforeEach(() => {
    clearCachedSecret();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Key Derivation
  // ─────────────────────────────────────────────────────────────────────────

  describe('deriveEncryptionKey', () => {
    it('derives a 256-bit key for session scope', async () => {
      const source: EncryptionKeySource = { type: 'session', sessionId: 'session-123' };
      const key = await deriveEncryptionKey(source);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32); // 256 bits
    });

    it('derives a 256-bit key for user scope', async () => {
      const source: EncryptionKeySource = { type: 'user', userId: 'user-456' };
      const key = await deriveEncryptionKey(source);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('derives a 256-bit key for tool scope', async () => {
      const source: EncryptionKeySource = {
        type: 'tool',
        toolName: 'my-tool',
        sessionId: 'session-789',
      };
      const key = await deriveEncryptionKey(source);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('derives a 256-bit key for global scope', async () => {
      const source: EncryptionKeySource = { type: 'global' };
      const key = await deriveEncryptionKey(source);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('derives a 256-bit key for custom scope', async () => {
      const source: EncryptionKeySource = { type: 'custom', key: 'my-custom-key' };
      const key = await deriveEncryptionKey(source);

      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('derives different keys for different sessions', async () => {
      const key1 = await deriveEncryptionKey({ type: 'session', sessionId: 'session-1' });
      const key2 = await deriveEncryptionKey({ type: 'session', sessionId: 'session-2' });

      // Compare Uint8Arrays
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });

    it('derives the same key for the same source', async () => {
      const source: EncryptionKeySource = { type: 'session', sessionId: 'session-123' };
      const key1 = await deriveEncryptionKey(source);
      const key2 = await deriveEncryptionKey(source);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });

    it('derives different keys for different scopes', async () => {
      const sessionKey = await deriveEncryptionKey({ type: 'session', sessionId: 'id-1' });
      const userKey = await deriveEncryptionKey({ type: 'user', userId: 'id-1' });

      expect(Buffer.from(sessionKey).equals(Buffer.from(userKey))).toBe(false);
    });

    // New test: session scope uses sessionId as IKM
    it('session scope derives key from sessionId only', async () => {
      // Same sessionId should always give same key regardless of environment
      const source: EncryptionKeySource = { type: 'session', sessionId: 'deterministic-session' };

      const key1 = await deriveEncryptionKey(source);
      const key2 = await deriveEncryptionKey(source);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });

    // New test: tool scope uses same IKM as session (sessionId)
    it('tool scope derives key from sessionId (same as session)', async () => {
      const toolSource: EncryptionKeySource = {
        type: 'tool',
        toolName: 'tool-a',
        sessionId: 'shared-session',
      };
      const toolSource2: EncryptionKeySource = {
        type: 'tool',
        toolName: 'tool-b',
        sessionId: 'shared-session',
      };

      const key1 = await deriveEncryptionKey(toolSource);
      const key2 = await deriveEncryptionKey(toolSource2);

      // Different tool names should still give different keys due to different context
      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(false);
    });
  });

  describe('getKeySourceForScope', () => {
    const context = {
      sessionId: 'session-abc',
      userId: 'user-xyz',
      toolName: 'test-tool',
    };

    it('returns session source for session scope', () => {
      const source = getKeySourceForScope('session', context);
      expect(source).toEqual({ type: 'session', sessionId: 'session-abc' });
    });

    it('returns user source for user scope', () => {
      const source = getKeySourceForScope('user', context);
      expect(source).toEqual({ type: 'user', userId: 'user-xyz' });
    });

    it('returns tool source for tool scope', () => {
      const source = getKeySourceForScope('tool', context);
      expect(source).toEqual({
        type: 'tool',
        toolName: 'test-tool',
        sessionId: 'session-abc',
      });
    });

    it('returns global source for global scope', () => {
      const source = getKeySourceForScope('global', context);
      expect(source).toEqual({ type: 'global' });
    });

    it('uses anonymous for user scope without userId', () => {
      const source = getKeySourceForScope('user', { sessionId: 'session-1' });
      expect(source).toEqual({ type: 'user', userId: 'anonymous' });
    });

    it('uses unknown for tool scope without toolName', () => {
      const source = getKeySourceForScope('tool', { sessionId: 'session-1' });
      expect(source).toEqual({
        type: 'tool',
        toolName: 'unknown',
        sessionId: 'session-1',
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Encryption / Decryption
  // ─────────────────────────────────────────────────────────────────────────

  describe('encryptValue / decryptValue', () => {
    const keySource: EncryptionKeySource = { type: 'session', sessionId: 'test-session' };

    it('encrypts and decrypts a simple string', async () => {
      const value = 'hello world';
      const blob = await encryptValue(value, keySource);
      const decrypted = await decryptValue(blob, keySource);

      expect(decrypted).toBe(value);
    });

    it('encrypts and decrypts an object', async () => {
      const value = { name: 'Alice', age: 30, active: true };
      const blob = await encryptValue(value, keySource);
      const decrypted = await decryptValue<typeof value>(blob, keySource);

      expect(decrypted).toEqual(value);
    });

    it('encrypts and decrypts an array', async () => {
      const value = [1, 2, 3, 'four', { five: 5 }];
      const blob = await encryptValue(value, keySource);
      const decrypted = await decryptValue(blob, keySource);

      expect(decrypted).toEqual(value);
    });

    it('encrypts and decrypts null', async () => {
      const blob = await encryptValue(null, keySource);
      const decrypted = await decryptValue(blob, keySource);

      expect(decrypted).toBeNull();
    });

    it('encrypts and decrypts special characters', async () => {
      const value = 'Unicode: 你好 🎉 Ümlauts: äöü';
      const blob = await encryptValue(value, keySource);
      const decrypted = await decryptValue(blob, keySource);

      expect(decrypted).toBe(value);
    });

    it('produces valid blob structure', async () => {
      const blob = await encryptValue('test', keySource);

      expect(blob.alg).toBe('A256GCM');
      expect(typeof blob.iv).toBe('string');
      expect(typeof blob.tag).toBe('string');
      expect(typeof blob.data).toBe('string');
      expect(blob.iv.length).toBeGreaterThan(0);
      expect(blob.tag.length).toBeGreaterThan(0);
      expect(blob.data.length).toBeGreaterThan(0);
    });

    it('produces different ciphertext for same plaintext (random IV)', async () => {
      const value = 'same value';
      const blob1 = await encryptValue(value, keySource);
      const blob2 = await encryptValue(value, keySource);

      // Same value but different IV means different ciphertext
      expect(blob1.iv).not.toBe(blob2.iv);
      expect(blob1.data).not.toBe(blob2.data);

      // Both should decrypt to the same value
      expect(await decryptValue(blob1, keySource)).toBe(value);
      expect(await decryptValue(blob2, keySource)).toBe(value);
    });

    it('returns null for tampered ciphertext', async () => {
      const blob = await encryptValue('secret', keySource);

      // Tamper with the data
      const tamperedBlob: EncryptedBlob = {
        ...blob,
        data: 'AAAA' + blob.data.slice(4),
      };

      const decrypted = await decryptValue(tamperedBlob, keySource);
      expect(decrypted).toBeNull();
    });

    it('returns null for wrong key', async () => {
      const blob = await encryptValue('secret', keySource);
      const wrongKey: EncryptionKeySource = { type: 'session', sessionId: 'wrong-session' };

      const decrypted = await decryptValue(blob, wrongKey);
      expect(decrypted).toBeNull();
    });

    it('returns null for corrupted IV', async () => {
      const blob = await encryptValue('secret', keySource);
      const corruptedBlob: EncryptedBlob = {
        ...blob,
        iv: 'corrupted',
      };

      const decrypted = await decryptValue(corruptedBlob, keySource);
      expect(decrypted).toBeNull();
    });

    it('returns null for corrupted tag', async () => {
      const blob = await encryptValue('secret', keySource);
      const corruptedBlob: EncryptedBlob = {
        ...blob,
        tag: 'corrupted',
      };

      const decrypted = await decryptValue(corruptedBlob, keySource);
      expect(decrypted).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('serializeBlob / deserializeBlob', () => {
    it('serializes blob to JSON string', () => {
      const blob: EncryptedBlob = {
        alg: 'A256GCM',
        iv: 'abc123',
        tag: 'def456',
        data: 'ghi789',
      };

      const serialized = serializeBlob(blob);
      expect(typeof serialized).toBe('string');

      const parsed = JSON.parse(serialized);
      expect(parsed).toEqual(blob);
    });

    it('deserializes valid blob string', () => {
      const blob: EncryptedBlob = {
        alg: 'A256GCM',
        iv: 'abc123',
        tag: 'def456',
        data: 'ghi789',
      };

      const serialized = JSON.stringify(blob);
      const deserialized = deserializeBlob(serialized);

      expect(deserialized).toEqual(blob);
    });

    it('returns null for invalid JSON', () => {
      const result = deserializeBlob('not valid json');
      expect(result).toBeNull();
    });

    it('returns null for wrong algorithm', () => {
      const result = deserializeBlob(
        JSON.stringify({
          alg: 'WRONG',
          iv: 'abc',
          tag: 'def',
          data: 'ghi',
        }),
      );
      expect(result).toBeNull();
    });

    it('returns null for missing iv', () => {
      const result = deserializeBlob(
        JSON.stringify({
          alg: 'A256GCM',
          tag: 'def',
          data: 'ghi',
        }),
      );
      expect(result).toBeNull();
    });

    it('returns null for missing tag', () => {
      const result = deserializeBlob(
        JSON.stringify({
          alg: 'A256GCM',
          iv: 'abc',
          data: 'ghi',
        }),
      );
      expect(result).toBeNull();
    });

    it('returns null for missing data', () => {
      const result = deserializeBlob(
        JSON.stringify({
          alg: 'A256GCM',
          iv: 'abc',
          tag: 'def',
        }),
      );
      expect(result).toBeNull();
    });

    it('returns null for non-object JSON', () => {
      expect(deserializeBlob('"string"')).toBeNull();
      expect(deserializeBlob('123')).toBeNull();
      expect(deserializeBlob('true')).toBeNull();
      expect(deserializeBlob('null')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Convenience Functions
  // ─────────────────────────────────────────────────────────────────────────

  describe('encryptAndSerialize / deserializeAndDecrypt', () => {
    const keySource: EncryptionKeySource = { type: 'user', userId: 'user-test' };

    it('encrypts, serializes, deserializes, and decrypts in one go', async () => {
      const value = { message: 'end to end test' };
      const serialized = await encryptAndSerialize(value, keySource);

      expect(typeof serialized).toBe('string');

      const decrypted = await deserializeAndDecrypt<typeof value>(serialized, keySource);
      expect(decrypted).toEqual(value);
    });

    it('returns null for invalid serialized string', async () => {
      const result = await deserializeAndDecrypt('not valid', keySource);
      expect(result).toBeNull();
    });

    it('returns null for wrong key', async () => {
      const serialized = await encryptAndSerialize('secret', keySource);
      const wrongKey: EncryptionKeySource = { type: 'user', userId: 'wrong-user' };

      const result = await deserializeAndDecrypt(serialized, wrongKey);
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Distributed-Safe Key Derivation
  // ─────────────────────────────────────────────────────────────────────────

  describe('distributed-safe key derivation', () => {
    it('session scope uses sessionId as sole input (distributed-safe)', async () => {
      // Session scope should derive key from sessionId only
      // This means the same sessionId will always produce the same key
      // regardless of which server handles the request
      const source: EncryptionKeySource = { type: 'session', sessionId: 'distributed-test' };

      const key1 = await deriveEncryptionKey(source);
      const key2 = await deriveEncryptionKey(source);

      expect(Buffer.from(key1).equals(Buffer.from(key2))).toBe(true);
    });

    it('data encrypted on one "server" can be decrypted on another (session scope)', async () => {
      const sessionId = 'cross-server-session';
      const keySource: EncryptionKeySource = { type: 'session', sessionId };
      const value = { sensitive: 'data' };

      // Simulate "server 1" encrypting
      const encrypted = await encryptAndSerialize(value, keySource);

      // Clear cache to simulate "server 2"
      clearCachedSecret();

      // Simulate "server 2" decrypting
      const decrypted = await deserializeAndDecrypt<typeof value>(encrypted, keySource);

      expect(decrypted).toEqual(value);
    });
  });
});
