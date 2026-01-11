/**
 * EncryptedTypedStorage Tests
 *
 * Tests for the EncryptedTypedStorage wrapper that provides transparent
 * encryption/decryption with key rotation support.
 */

import { z } from 'zod';
import { MemoryStorageAdapter, randomBytes } from '@frontmcp/utils';
import { EncryptedTypedStorage, EncryptedStorageError } from '../encrypted-typed-storage';
import type { EncryptionKey } from '../encrypted-typed-storage.types';

interface TestSecret {
  apiKey: string;
  refreshToken?: string;
}

const testSecretSchema = z.object({
  apiKey: z.string(),
  refreshToken: z.string().optional(),
});

describe('EncryptedTypedStorage', () => {
  let adapter: MemoryStorageAdapter;
  let key1: EncryptionKey;
  let key2: EncryptionKey;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    key1 = { kid: 'key-1', key: randomBytes(32) };
    key2 = { kid: 'key-2', key: randomBytes(32) };
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('constructor', () => {
    it('should create with a single key', () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      expect(storage).toBeInstanceOf(EncryptedTypedStorage);
      expect(storage.activeKeyId).toBe('key-1');
    });

    it('should create with multiple keys for rotation', () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1, key2],
      });
      expect(storage.activeKeyId).toBe('key-1');
      expect(storage.keyIds).toEqual(['key-1', 'key-2']);
    });

    it('should throw if no keys provided', () => {
      expect(() => {
        new EncryptedTypedStorage<TestSecret>(adapter, { keys: [] });
      }).toThrow(EncryptedStorageError);
    });

    it('should throw if key is not 32 bytes', () => {
      expect(() => {
        new EncryptedTypedStorage<TestSecret>(adapter, {
          keys: [{ kid: 'short', key: randomBytes(16) }],
        });
      }).toThrow('must be 32 bytes');
    });

    it('should accept schema for validation', () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        schema: testSecretSchema,
      });
      expect(storage).toBeInstanceOf(EncryptedTypedStorage);
    });
  });

  describe('get/set', () => {
    it('should encrypt and store a value', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const secret: TestSecret = { apiKey: 'sk-12345', refreshToken: 'rt-67890' };

      await storage.set('secret:1', secret);

      // Check that raw storage contains encrypted data
      const raw = await adapter.get('secret:1');
      expect(raw).toBeDefined();
      expect(raw).not.toContain('sk-12345'); // Should be encrypted
      expect(raw).toContain('"alg":"A256GCM"');
      expect(raw).toContain('"kid":"key-1"');
    });

    it('should decrypt and retrieve a value', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const secret: TestSecret = { apiKey: 'sk-12345', refreshToken: 'rt-67890' };

      await storage.set('secret:1', secret);
      const retrieved = await storage.get('secret:1');

      expect(retrieved).toEqual(secret);
    });

    it('should return null for non-existent key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      const result = await storage.get('non-existent');
      expect(result).toBeNull();
    });

    it('should support TTL option', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const secret: TestSecret = { apiKey: 'sk-12345' };

      await storage.set('secret:1', secret, { ttlSeconds: 3600 });

      const result = await storage.get('secret:1');
      expect(result).toEqual(secret);

      const ttl = await storage.ttl('secret:1');
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe('delete', () => {
    it('should delete an existing key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const secret: TestSecret = { apiKey: 'sk-12345' };

      await storage.set('secret:1', secret);
      const deleted = await storage.delete('secret:1');

      expect(deleted).toBe(true);
      expect(await storage.get('secret:1')).toBeNull();
    });

    it('should return false for non-existent key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      const deleted = await storage.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage.set('secret:1', { apiKey: 'sk-12345' });

      expect(await storage.exists('secret:1')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      expect(await storage.exists('non-existent')).toBe(false);
    });
  });

  describe('mget/mset', () => {
    it('should encrypt and store multiple values', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const secrets: TestSecret[] = [{ apiKey: 'sk-1' }, { apiKey: 'sk-2' }, { apiKey: 'sk-3' }];

      await storage.mset(secrets.map((s, i) => ({ key: `secret:${i}`, value: s })));

      const retrieved = await storage.mget(['secret:0', 'secret:1', 'secret:2']);
      expect(retrieved).toEqual(secrets);
    });

    it('should return null for missing keys in mget', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage.set('secret:1', { apiKey: 'sk-1' });

      const retrieved = await storage.mget(['secret:1', 'secret:2']);
      expect(retrieved).toEqual([{ apiKey: 'sk-1' }, null]);
    });

    it('should handle empty arrays', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      await storage.mset([]);
      const result = await storage.mget([]);
      expect(result).toEqual([]);
    });
  });

  describe('mdelete', () => {
    it('should delete multiple keys', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage.mset([
        { key: 'secret:1', value: { apiKey: 'sk-1' } },
        { key: 'secret:2', value: { apiKey: 'sk-2' } },
      ]);

      const deleted = await storage.mdelete(['secret:1', 'secret:2']);
      expect(deleted).toBe(2);

      expect(await storage.exists('secret:1')).toBe(false);
      expect(await storage.exists('secret:2')).toBe(false);
    });
  });

  describe('key rotation', () => {
    it('should decrypt values encrypted with old keys', async () => {
      // Create storage with key1
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage1.set('secret:1', { apiKey: 'sk-old' });

      // Create new storage with key2 active, key1 for decryption
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2, key1], // key2 is active, key1 still available
      });

      // Should still decrypt the old value
      const retrieved = await storage2.get('secret:1');
      expect(retrieved).toEqual({ apiKey: 'sk-old' });
    });

    it('should encrypt new values with the active key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2, key1],
      });

      await storage.set('secret:new', { apiKey: 'sk-new' });

      // Check raw storage uses the active key
      const raw = await adapter.get('secret:new');
      expect(raw).toContain('"kid":"key-2"');
    });

    it('should notify when decrypting with non-active key', async () => {
      // Store with key1
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage1.set('secret:1', { apiKey: 'sk-old' });

      // Create new storage with callback
      const rotationNeeded: Array<{ key: string; oldKid: string; newKid: string }> = [];
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2, key1],
        onKeyRotationNeeded: (key, oldKid, newKid) => {
          rotationNeeded.push({ key, oldKid, newKid });
        },
      });

      await storage2.get('secret:1');

      expect(rotationNeeded).toHaveLength(1);
      expect(rotationNeeded[0]).toEqual({
        key: 'secret:1',
        oldKid: 'key-1',
        newKid: 'key-2',
      });
    });

    it('should re-encrypt values with the active key', async () => {
      // Store with key1
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage1.set('secret:1', { apiKey: 'sk-value' });

      // Create storage with key2 active
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2, key1],
      });

      // Re-encrypt
      const reencrypted = await storage2.reencrypt('secret:1');
      expect(reencrypted).toBe(true);

      // Verify raw storage now uses key2
      const raw = await adapter.get('secret:1');
      expect(raw).toContain('"kid":"key-2"');

      // Verify data is still correct
      const retrieved = await storage2.get('secret:1');
      expect(retrieved).toEqual({ apiKey: 'sk-value' });
    });

    it('should return false when re-encrypting non-existent key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      const result = await storage.reencrypt('non-existent');
      expect(result).toBe(false);
    });

    it('should support runtime key rotation', () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      const key3: EncryptionKey = { kid: 'key-3', key: randomBytes(32) };

      storage.rotateKey(key3);

      expect(storage.activeKeyId).toBe('key-3');
      expect(storage.keyIds).toContain('key-3');
    });

    it('should throw when rotating to invalid key', () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      expect(() => {
        storage.rotateKey({ kid: 'bad', key: randomBytes(16) });
      }).toThrow('must be 32 bytes');
    });
  });

  describe('schema validation', () => {
    it('should validate decrypted data against schema', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        schema: testSecretSchema,
      });

      await storage.set('secret:1', { apiKey: 'sk-12345' });
      const retrieved = await storage.get('secret:1');

      expect(retrieved).toEqual({ apiKey: 'sk-12345' });
    });

    it('should return null for invalid data when throwOnError is false', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        schema: testSecretSchema,
        throwOnError: false,
      });

      // Store invalid data by bypassing encryption
      const invalidStorage = new EncryptedTypedStorage<{ wrong: boolean }>(adapter, {
        keys: [key1],
      });
      await invalidStorage.set('secret:invalid', { wrong: true });

      const result = await storage.get('secret:invalid');
      expect(result).toBeNull();
    });

    it('should throw for invalid data when throwOnError is true', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        schema: testSecretSchema,
        throwOnError: true,
      });

      // Store invalid data by bypassing schema
      const noSchemaStorage = new EncryptedTypedStorage<{ wrong: boolean }>(adapter, {
        keys: [key1],
      });
      await noSchemaStorage.set('secret:invalid', { wrong: true });

      await expect(storage.get('secret:invalid')).rejects.toThrow('Schema validation failed');
    });
  });

  describe('error handling', () => {
    it('should return null for corrupted data when throwOnError is false', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        throwOnError: false,
      });

      // Store corrupted data directly
      await adapter.set('secret:corrupted', 'not valid json');

      const result = await storage.get('secret:corrupted');
      expect(result).toBeNull();
    });

    it('should throw for corrupted data when throwOnError is true', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        throwOnError: true,
      });

      await adapter.set('secret:corrupted', 'not valid json');

      await expect(storage.get('secret:corrupted')).rejects.toThrow('Failed to parse');
    });

    it('should return null for unknown key ID when throwOnError is false', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        throwOnError: false,
      });

      // Store with key2 which storage doesn't know about
      const otherStorage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key2] });
      await otherStorage.set('secret:unknown', { apiKey: 'sk-123' });

      const result = await storage.get('secret:unknown');
      expect(result).toBeNull();
    });

    it('should throw for unknown key ID when throwOnError is true', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        throwOnError: true,
      });

      // Store with key2
      const otherStorage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key2] });
      await otherStorage.set('secret:unknown', { apiKey: 'sk-123' });

      await expect(storage.get('secret:unknown')).rejects.toThrow('Unknown encryption key');
    });

    it('should return null for decryption failure when throwOnError is false', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        throwOnError: false,
      });

      // Store valid-looking but undecryptable blob
      await adapter.set(
        'secret:tampered',
        JSON.stringify({
          alg: 'A256GCM',
          kid: 'key-1',
          iv: 'AAAAAAAAAAAAAAAA',
          tag: 'AAAAAAAAAAAAAAAAAAAAAA',
          data: 'tampereddata',
        }),
      );

      const result = await storage.get('secret:tampered');
      expect(result).toBeNull();
    });
  });

  describe('keys/count', () => {
    it('should list keys matching pattern', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      await storage.mset([
        { key: 'secret:1', value: { apiKey: 'sk-1' } },
        { key: 'secret:2', value: { apiKey: 'sk-2' } },
        { key: 'other:1', value: { apiKey: 'other' } },
      ]);

      const keys = await storage.keys('secret:*');
      expect(keys.sort()).toEqual(['secret:1', 'secret:2']);
    });

    it('should count keys matching pattern', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      await storage.mset([
        { key: 'secret:1', value: { apiKey: 'sk-1' } },
        { key: 'secret:2', value: { apiKey: 'sk-2' } },
        { key: 'secret:3', value: { apiKey: 'sk-3' } },
      ]);

      const count = await storage.count('secret:*');
      expect(count).toBe(3);
    });
  });

  describe('expire/ttl', () => {
    it('should set TTL on existing key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      await storage.set('secret:1', { apiKey: 'sk-1' });

      const result = await storage.expire('secret:1', 3600);
      expect(result).toBe(true);

      const ttl = await storage.ttl('secret:1');
      expect(ttl).toBeLessThanOrEqual(3600);
      expect(ttl).toBeGreaterThan(0);
    });

    it('should return false for non-existent key', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });

      const result = await storage.expire('non-existent', 3600);
      expect(result).toBe(false);
    });
  });

  describe('raw access', () => {
    it('should expose the underlying storage adapter', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, { keys: [key1] });
      expect(storage.raw).toBe(adapter);
    });
  });

  describe('complex data types', () => {
    interface ComplexSecret {
      tokens: string[];
      metadata: {
        createdAt: number;
        scopes: string[];
      };
      nested?: {
        deep: {
          value: string;
        };
      };
    }

    it('should handle complex nested objects', async () => {
      const storage = new EncryptedTypedStorage<ComplexSecret>(adapter, { keys: [key1] });

      const secret: ComplexSecret = {
        tokens: ['token1', 'token2'],
        metadata: {
          createdAt: Date.now(),
          scopes: ['read', 'write'],
        },
        nested: {
          deep: {
            value: 'secret-value',
          },
        },
      };

      await storage.set('complex:1', secret);
      const retrieved = await storage.get('complex:1');

      expect(retrieved).toEqual(secret);
    });

    it('should handle arrays of objects', async () => {
      const storage = new EncryptedTypedStorage<TestSecret[]>(adapter, { keys: [key1] });

      const secrets: TestSecret[] = [{ apiKey: 'sk-1', refreshToken: 'rt-1' }, { apiKey: 'sk-2' }];

      await storage.set('array:1', secrets);
      const retrieved = await storage.get('array:1');

      expect(retrieved).toEqual(secrets);
    });
  });

  describe('client-side key binding', () => {
    it('should encrypt and decrypt with client binding (string secret)', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-123' },
      });

      const secret: TestSecret = { apiKey: 'sk-bound' };
      await storage.set('bound:1', secret);

      const retrieved = await storage.get('bound:1');
      expect(retrieved).toEqual(secret);
    });

    it('should encrypt and decrypt with client binding (Uint8Array secret)', async () => {
      const clientSecret = new TextEncoder().encode('session-123');
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: clientSecret },
      });

      const secret: TestSecret = { apiKey: 'sk-bound-bytes' };
      await storage.set('bound:2', secret);

      const retrieved = await storage.get('bound:2');
      expect(retrieved).toEqual(secret);
    });

    it('should derive same key for string and Uint8Array representations', async () => {
      const sessionId = 'session-same-key';

      // Create storage with string secret
      const storageString = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: sessionId },
      });

      // Create storage with Uint8Array secret (same value)
      const storageBytes = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: new TextEncoder().encode(sessionId) },
      });

      const secret: TestSecret = { apiKey: 'sk-same-key' };
      await storageString.set('same:1', secret);

      // Should be able to decrypt with Uint8Array version
      const retrieved = await storageBytes.get('same:1');
      expect(retrieved).toEqual(secret);
    });

    it('should fail to decrypt with different client secret', async () => {
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1' },
      });
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1], // Same server key
        clientBinding: { secret: 'session-2' }, // Different client secret
      });

      const secret: TestSecret = { apiKey: 'sk-isolated' };
      await storage1.set('isolated:1', secret);

      // storage2 cannot decrypt storage1's data
      const result = await storage2.get('isolated:1');
      expect(result).toBeNull();
    });

    it('should fail to decrypt without client binding when encrypted with binding', async () => {
      const storageWithBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-abc' },
      });
      const storageWithoutBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        // No clientBinding - uses server key directly
      });

      const secret: TestSecret = { apiKey: 'sk-binding-required' };
      await storageWithBinding.set('binding-required:1', secret);

      // Without binding, cannot decrypt
      const result = await storageWithoutBinding.get('binding-required:1');
      expect(result).toBeNull();
    });

    it('should fail to decrypt with client binding when encrypted without binding', async () => {
      const storageWithoutBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        // No clientBinding
      });
      const storageWithBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-xyz' },
      });

      const secret: TestSecret = { apiKey: 'sk-no-binding' };
      await storageWithoutBinding.set('no-binding:1', secret);

      // With binding, cannot decrypt data stored without binding
      const result = await storageWithBinding.get('no-binding:1');
      expect(result).toBeNull();
    });

    it('should use domain separation via info parameter', async () => {
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1', info: 'domain-a' },
      });
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1', info: 'domain-b' }, // Same secret, different info
      });

      const secret: TestSecret = { apiKey: 'sk-domain' };
      await storage1.set('domain:1', secret);

      // Different info produces different derived key
      const result = await storage2.get('domain:1');
      expect(result).toBeNull();
    });

    it('should use custom salt for key derivation', async () => {
      const salt = randomBytes(16);
      const storageWithSalt = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1', salt },
      });
      const storageWithoutSalt = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1' }, // No salt (defaults to empty)
      });

      const secret: TestSecret = { apiKey: 'sk-salted' };
      await storageWithSalt.set('salted:1', secret);

      // Different salt produces different derived key
      const result = await storageWithoutSalt.get('salted:1');
      expect(result).toBeNull();
    });

    it('should expose hasClientBinding property', () => {
      const withBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1' },
      });
      const withoutBinding = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
      });

      expect(withBinding.hasClientBinding).toBe(true);
      expect(withoutBinding.hasClientBinding).toBe(false);
    });

    it('should work without client binding (debugging mode)', async () => {
      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        // No clientBinding - for debugging
      });

      const secret: TestSecret = { apiKey: 'sk-debug' };
      await storage.set('debug:1', secret);

      const retrieved = await storage.get('debug:1');
      expect(retrieved).toEqual(secret);
    });

    it('should support key rotation with client binding', async () => {
      const rotationCalls: string[] = [];

      const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2, key1], // key2 is active, key1 for decryption of old data
        clientBinding: { secret: 'session-rotation' },
        onKeyRotationNeeded: (key, oldKid) => {
          rotationCalls.push(`${key}:${oldKid}`);
        },
      });

      // First, store data with key1 using another instance
      const oldStorage = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-rotation' },
      });
      await oldStorage.set('rotate:1', { apiKey: 'sk-old' });

      // Read with new storage - should trigger rotation callback
      const retrieved = await storage.get('rotate:1');
      expect(retrieved).toEqual({ apiKey: 'sk-old' });
      expect(rotationCalls).toContain('rotate:1:key-1');

      // Re-encrypt with new key
      await storage.reencrypt('rotate:1');

      // Now can read with just key2
      rotationCalls.length = 0;
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key2],
        clientBinding: { secret: 'session-rotation' },
        onKeyRotationNeeded: (key, oldKid) => {
          rotationCalls.push(`${key}:${oldKid}`);
        },
      });
      const afterRotation = await storage2.get('rotate:1');
      expect(afterRotation).toEqual({ apiKey: 'sk-old' });
      expect(rotationCalls).toHaveLength(0); // No rotation needed
    });

    it('should isolate data per session even with same server key', async () => {
      // Simulate multiple MCP client sessions
      const sessions = ['session-alice', 'session-bob', 'session-charlie'];

      // Each session encrypts their own data
      for (const sessionId of sessions) {
        const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
          keys: [key1],
          clientBinding: { secret: sessionId },
        });
        await storage.set(`data:${sessionId}`, { apiKey: `sk-${sessionId}` });
      }

      // Each session can only read their own data
      for (const sessionId of sessions) {
        const storage = new EncryptedTypedStorage<TestSecret>(adapter, {
          keys: [key1],
          clientBinding: { secret: sessionId },
        });

        // Can read own data
        const ownData = await storage.get(`data:${sessionId}`);
        expect(ownData).toEqual({ apiKey: `sk-${sessionId}` });

        // Cannot read other sessions' data
        for (const otherSession of sessions) {
          if (otherSession !== sessionId) {
            const otherData = await storage.get(`data:${otherSession}`);
            expect(otherData).toBeNull();
          }
        }
      }
    });

    it('should throw on decryption failure with client binding when throwOnError is true', async () => {
      const storage1 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-1' },
      });
      const storage2 = new EncryptedTypedStorage<TestSecret>(adapter, {
        keys: [key1],
        clientBinding: { secret: 'session-2' },
        throwOnError: true,
      });

      await storage1.set('secret:throw', { apiKey: 'sk-throw' });

      await expect(storage2.get('secret:throw')).rejects.toThrow(EncryptedStorageError);
    });
  });
});
