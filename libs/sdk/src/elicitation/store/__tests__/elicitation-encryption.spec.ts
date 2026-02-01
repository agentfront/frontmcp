/**
 * Elicitation Encryption Tests
 *
 * Tests for session-based encryption of elicitation store data.
 */

import {
  deriveElicitationKey,
  encryptElicitationData,
  decryptElicitationData,
  isEncryptedBlob,
  serializeElicitationBlob,
  deserializeElicitationBlob,
  encryptAndSerialize,
  deserializeAndDecrypt,
  tryDecryptStoredValue,
  getElicitationSecret,
  isElicitationEncryptionAvailable,
} from '../elicitation-encryption';

describe('elicitation-encryption', () => {
  const testSecret = 'test-server-secret-12345';
  const testSessionId1 = 'session-abc-123';
  const testSessionId2 = 'session-def-456';
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env['MCP_ELICITATION_SECRET'];
    delete process.env['MCP_SESSION_SECRET'];
    delete process.env['MCP_SERVER_SECRET'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getElicitationSecret', () => {
    it('should return null when no secret is configured', () => {
      expect(getElicitationSecret()).toBeNull();
    });

    it('should return MCP_ELICITATION_SECRET when set', () => {
      process.env['MCP_ELICITATION_SECRET'] = 'secret1';
      expect(getElicitationSecret()).toBe('secret1');
    });

    it('should return MCP_SESSION_SECRET as fallback', () => {
      process.env['MCP_SESSION_SECRET'] = 'secret2';
      expect(getElicitationSecret()).toBe('secret2');
    });

    it('should return MCP_SERVER_SECRET as last fallback', () => {
      process.env['MCP_SERVER_SECRET'] = 'secret3';
      expect(getElicitationSecret()).toBe('secret3');
    });

    it('should prioritize MCP_ELICITATION_SECRET over others', () => {
      process.env['MCP_ELICITATION_SECRET'] = 'secret1';
      process.env['MCP_SESSION_SECRET'] = 'secret2';
      process.env['MCP_SERVER_SECRET'] = 'secret3';
      expect(getElicitationSecret()).toBe('secret1');
    });
  });

  describe('isElicitationEncryptionAvailable', () => {
    it('should return false when no secret is configured', () => {
      expect(isElicitationEncryptionAvailable()).toBe(false);
    });

    it('should return true when secret is configured', () => {
      process.env['MCP_ELICITATION_SECRET'] = testSecret;
      expect(isElicitationEncryptionAvailable()).toBe(true);
    });
  });

  describe('deriveElicitationKey', () => {
    it('should derive a 32-byte key', async () => {
      const key = await deriveElicitationKey(testSessionId1, testSecret);
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });

    it('should derive different keys for different sessions', async () => {
      const key1 = await deriveElicitationKey(testSessionId1, testSecret);
      const key2 = await deriveElicitationKey(testSessionId2, testSecret);
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    });

    it('should derive same key for same session (deterministic)', async () => {
      const key1 = await deriveElicitationKey(testSessionId1, testSecret);
      const key2 = await deriveElicitationKey(testSessionId1, testSecret);
      expect(Buffer.from(key1).toString('hex')).toBe(Buffer.from(key2).toString('hex'));
    });

    it('should derive different keys for different secrets', async () => {
      const key1 = await deriveElicitationKey(testSessionId1, 'secret-1');
      const key2 = await deriveElicitationKey(testSessionId1, 'secret-2');
      expect(Buffer.from(key1).toString('hex')).not.toBe(Buffer.from(key2).toString('hex'));
    });

    it('should throw when no secret is available', async () => {
      await expect(deriveElicitationKey(testSessionId1)).rejects.toThrow(
        'Elicitation encryption requires a server secret',
      );
    });

    it('should use env var when no secret is provided', async () => {
      process.env['MCP_ELICITATION_SECRET'] = testSecret;
      const key = await deriveElicitationKey(testSessionId1);
      expect(key).toBeInstanceOf(Uint8Array);
      expect(key.length).toBe(32);
    });
  });

  describe('encryptElicitationData / decryptElicitationData', () => {
    const testData = {
      elicitId: 'elicit-123',
      sessionId: testSessionId1,
      message: 'Test message',
      createdAt: Date.now(),
    };

    it('should encrypt and decrypt data correctly', async () => {
      const encrypted = await encryptElicitationData(testData, testSessionId1, testSecret);
      const decrypted = await decryptElicitationData(encrypted, testSessionId1, testSecret);
      expect(decrypted).toEqual(testData);
    });

    it('should produce encrypted blob with correct structure', async () => {
      const encrypted = await encryptElicitationData(testData, testSessionId1, testSecret);
      expect(encrypted).toHaveProperty('alg', 'A256GCM');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('tag');
      expect(encrypted).toHaveProperty('data');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.tag).toBe('string');
      expect(typeof encrypted.data).toBe('string');
    });

    it('should produce different ciphertext each time (random IV)', async () => {
      const encrypted1 = await encryptElicitationData(testData, testSessionId1, testSecret);
      const encrypted2 = await encryptElicitationData(testData, testSessionId1, testSecret);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it('should fail to decrypt with wrong session', async () => {
      const encrypted = await encryptElicitationData(testData, testSessionId1, testSecret);
      const decrypted = await decryptElicitationData(encrypted, testSessionId2, testSecret);
      expect(decrypted).toBeNull();
    });

    it('should fail to decrypt with wrong secret', async () => {
      const encrypted = await encryptElicitationData(testData, testSessionId1, testSecret);
      const decrypted = await decryptElicitationData(encrypted, testSessionId1, 'wrong-secret');
      expect(decrypted).toBeNull();
    });

    it('should handle complex nested data', async () => {
      const complexData = {
        nested: {
          array: [1, 2, 3],
          object: { a: 'b', c: null },
          boolean: true,
        },
        unicode: 'Hello \u{1F60A} World',
      };
      const encrypted = await encryptElicitationData(complexData, testSessionId1, testSecret);
      const decrypted = await decryptElicitationData(encrypted, testSessionId1, testSecret);
      expect(decrypted).toEqual(complexData);
    });
  });

  describe('isEncryptedBlob', () => {
    it('should return true for valid encrypted blob', async () => {
      const encrypted = await encryptElicitationData({ test: true }, testSessionId1, testSecret);
      expect(isEncryptedBlob(encrypted)).toBe(true);
    });

    it('should return false for non-objects', () => {
      expect(isEncryptedBlob(null)).toBe(false);
      expect(isEncryptedBlob(undefined)).toBe(false);
      expect(isEncryptedBlob('string')).toBe(false);
      expect(isEncryptedBlob(123)).toBe(false);
    });

    it('should return false for wrong algorithm', () => {
      expect(isEncryptedBlob({ alg: 'AES128', iv: 'a', tag: 'b', data: 'c' })).toBe(false);
    });

    it('should return false for missing fields', () => {
      expect(isEncryptedBlob({ alg: 'A256GCM', iv: 'a', tag: 'b' })).toBe(false);
      expect(isEncryptedBlob({ alg: 'A256GCM', iv: 'a', data: 'c' })).toBe(false);
      expect(isEncryptedBlob({ alg: 'A256GCM', tag: 'b', data: 'c' })).toBe(false);
    });

    it('should return false for non-string fields', () => {
      expect(isEncryptedBlob({ alg: 'A256GCM', iv: 123, tag: 'b', data: 'c' })).toBe(false);
    });
  });

  describe('serializeElicitationBlob / deserializeElicitationBlob', () => {
    it('should serialize and deserialize correctly', async () => {
      const encrypted = await encryptElicitationData({ test: true }, testSessionId1, testSecret);
      const serialized = serializeElicitationBlob(encrypted);
      const deserialized = deserializeElicitationBlob(serialized);
      expect(deserialized).toEqual(encrypted);
    });

    it('should return null for invalid JSON', () => {
      expect(deserializeElicitationBlob('not json')).toBeNull();
    });

    it('should return null for non-blob JSON', () => {
      expect(deserializeElicitationBlob('{"foo":"bar"}')).toBeNull();
    });
  });

  describe('encryptAndSerialize / deserializeAndDecrypt', () => {
    const testData = { elicitId: 'test-123', message: 'Hello' };

    it('should encrypt, serialize, deserialize, and decrypt correctly', async () => {
      const serialized = await encryptAndSerialize(testData, testSessionId1, testSecret);
      expect(typeof serialized).toBe('string');

      const decrypted = await deserializeAndDecrypt(serialized, testSessionId1, testSecret);
      expect(decrypted).toEqual(testData);
    });

    it('should return null for corrupted data', async () => {
      const decrypted = await deserializeAndDecrypt('corrupted', testSessionId1, testSecret);
      expect(decrypted).toBeNull();
    });

    it('should return null for plaintext JSON (no migration)', async () => {
      const plaintext = JSON.stringify(testData);
      const decrypted = await deserializeAndDecrypt(plaintext, testSessionId1, testSecret);
      expect(decrypted).toBeNull();
    });
  });

  describe('tryDecryptStoredValue', () => {
    it('should decrypt encrypted blob', async () => {
      const testData = { test: true };
      const encrypted = await encryptElicitationData(testData, testSessionId1, testSecret);
      const decrypted = await tryDecryptStoredValue(encrypted, testSessionId1, testSecret);
      expect(decrypted).toEqual(testData);
    });

    it('should return null for non-encrypted value', async () => {
      const plainData = { test: true };
      const result = await tryDecryptStoredValue(plainData, testSessionId1, testSecret);
      expect(result).toBeNull();
    });

    it('should return null for failed decryption (wrong session)', async () => {
      const encrypted = await encryptElicitationData({ test: true }, testSessionId1, testSecret);
      const result = await tryDecryptStoredValue(encrypted, testSessionId2, testSecret);
      expect(result).toBeNull();
    });
  });

  describe('cross-session isolation', () => {
    it('should prevent session 2 from decrypting session 1 data', async () => {
      const session1Data = { secret: 'session1-secret-value' };

      // Session 1 encrypts data
      const encrypted = await encryptElicitationData(session1Data, testSessionId1, testSecret);

      // Session 2 tries to decrypt - should fail
      const decrypted = await decryptElicitationData(encrypted, testSessionId2, testSecret);
      expect(decrypted).toBeNull();

      // Session 1 can still decrypt
      const session1Decrypted = await decryptElicitationData(encrypted, testSessionId1, testSecret);
      expect(session1Decrypted).toEqual(session1Data);
    });

    it('should isolate data between many sessions', async () => {
      const sessions = ['session-a', 'session-b', 'session-c', 'session-d', 'session-e'];
      const encrypted: Array<{ session: string; blob: Awaited<ReturnType<typeof encryptElicitationData>> }> = [];

      // Encrypt unique data for each session
      for (const session of sessions) {
        const data = { session, secretValue: `secret-for-${session}` };
        const blob = await encryptElicitationData(data, session, testSecret);
        encrypted.push({ session, blob });
      }

      // Verify each session can only decrypt its own data
      for (const { session, blob } of encrypted) {
        // Can decrypt own data
        const own = await decryptElicitationData(blob, session, testSecret);
        expect(own).toEqual({ session, secretValue: `secret-for-${session}` });

        // Cannot decrypt other sessions' data
        for (const otherSession of sessions.filter((s) => s !== session)) {
          const other = await decryptElicitationData(blob, otherSession, testSecret);
          expect(other).toBeNull();
        }
      }
    });
  });
});
