/**
 * KeyPersistence Tests
 */

import { KeyPersistence } from '../key-persistence';
import { validateKeyData, parseKeyData, isSecretKeyData, isAsymmetricKeyData } from '../schemas';
import { createKeyPersistence, createKeyPersistenceWithStorage } from '../factory';
import { MemoryStorageAdapter } from '../../../storage/adapters/memory';
import { FileSystemStorageAdapter } from '../../../storage/adapters/filesystem';
import type { SecretKeyData, AsymmetricKeyData } from '../types';
import { rm, mkdtemp } from '../../../fs';
import * as path from 'path';
import * as os from 'os';

describe('KeyPersistence', () => {
  let storage: MemoryStorageAdapter;
  let keys: KeyPersistence;

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();
    await storage.connect();
    keys = new KeyPersistence({ storage });
  });

  afterEach(async () => {
    await storage.disconnect();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve a secret key', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'test-secret',
        secret: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY',
        bytes: 32,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      const retrieved = await keys.get('test-secret');

      expect(retrieved).toEqual(secret);
    });

    it('should store and retrieve an asymmetric key', async () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'test-asymmetric',
        alg: 'RS256',
        privateKey: { kty: 'RSA', n: 'test-n', e: 'AQAB' },
        publicJwk: { keys: [{ kty: 'RSA', n: 'test-n', e: 'AQAB' }] },
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(asymmetric);
      const retrieved = await keys.get('test-asymmetric');

      expect(retrieved).toEqual(asymmetric);
    });

    it('should return null for non-existent key', async () => {
      const result = await keys.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete a key', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'to-delete',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      expect(await keys.has('to-delete')).toBe(true);

      const deleted = await keys.delete('to-delete');
      expect(deleted).toBe(true);
      expect(await keys.has('to-delete')).toBe(false);
    });

    it('should return false when deleting non-existent key', async () => {
      const deleted = await keys.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should check if key exists', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'exists-check',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      expect(await keys.has('exists-check')).toBe(true);
      expect(await keys.has('nonexistent')).toBe(false);
    });

    it('should list all keys', async () => {
      await keys.set({
        type: 'secret',
        kid: 'key1',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      });
      await keys.set({
        type: 'secret',
        kid: 'key2',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      });

      const list = await keys.list();
      expect(list.sort()).toEqual(['key1', 'key2'].sort());
    });
  });

  describe('Typed Getters', () => {
    it('should get secret key with getSecret()', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'my-secret',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      const retrieved = await keys.getSecret('my-secret');

      expect(retrieved).toEqual(secret);
      expect(retrieved?.type).toBe('secret');
    });

    it('should return null for wrong key type with getSecret()', async () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'not-a-secret',
        alg: 'RS256',
        privateKey: { kty: 'RSA' },
        publicJwk: { keys: [{ kty: 'RSA' }] },
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(asymmetric);
      const retrieved = await keys.getSecret('not-a-secret');

      expect(retrieved).toBeNull();
    });

    it('should get asymmetric key with getAsymmetric()', async () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'my-asymmetric',
        alg: 'ES256',
        privateKey: { kty: 'EC' },
        publicJwk: { keys: [{ kty: 'EC' }] },
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(asymmetric);
      const retrieved = await keys.getAsymmetric('my-asymmetric');

      expect(retrieved).toEqual(asymmetric);
      expect(retrieved?.type).toBe('asymmetric');
    });

    it('should return null for wrong key type with getAsymmetric()', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'not-asymmetric',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      const retrieved = await keys.getAsymmetric('not-asymmetric');

      expect(retrieved).toBeNull();
    });
  });

  describe('getOrCreateSecret', () => {
    it('should create a new secret when key does not exist', async () => {
      const secret = await keys.getOrCreateSecret('new-key');

      expect(secret.type).toBe('secret');
      expect(secret.kid).toBe('new-key');
      expect(secret.bytes).toBe(32); // Default
      expect(secret.secret).toHaveLength(43); // 32 bytes in base64url
      expect(secret.createdAt).toBeLessThanOrEqual(Date.now());
      expect(secret.version).toBe(1);
    });

    it('should return existing secret when key exists', async () => {
      const original = await keys.getOrCreateSecret('existing-key');
      const retrieved = await keys.getOrCreateSecret('existing-key');

      expect(retrieved).toEqual(original);
    });

    it('should respect custom byte size', async () => {
      const secret = await keys.getOrCreateSecret('custom-size', { bytes: 64 });

      expect(secret.bytes).toBe(64);
      expect(secret.secret).toHaveLength(86); // 64 bytes in base64url
    });

    it('should persist the created secret', async () => {
      const secret = await keys.getOrCreateSecret('persistent-key');

      // Create new KeyPersistence instance with same storage
      const keys2 = new KeyPersistence({ storage });
      const retrieved = await keys2.getSecret('persistent-key');

      expect(retrieved).toEqual(secret);
    });
  });

  describe('Caching', () => {
    it('should cache keys by default', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'cached',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      expect(keys.isCached('cached')).toBe(true);

      // Get should use cache
      const retrieved = await keys.get('cached');
      expect(retrieved).toEqual(secret);
    });

    it('should clear cache for specific key', async () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'to-clear',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await keys.set(secret);
      expect(keys.isCached('to-clear')).toBe(true);

      keys.clearCacheFor('to-clear');
      expect(keys.isCached('to-clear')).toBe(false);
    });

    it('should clear entire cache', async () => {
      await keys.set({
        type: 'secret',
        kid: 'key1',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      });
      await keys.set({
        type: 'secret',
        kid: 'key2',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      });

      expect(keys.isCached('key1')).toBe(true);
      expect(keys.isCached('key2')).toBe(true);

      keys.clearCache();

      expect(keys.isCached('key1')).toBe(false);
      expect(keys.isCached('key2')).toBe(false);
    });

    it('should work without cache when disabled', async () => {
      const noCacheKeys = new KeyPersistence({
        storage,
        enableCache: false,
      });

      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'no-cache',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      };

      await noCacheKeys.set(secret);
      expect(noCacheKeys.isCached('no-cache')).toBe(false);

      const retrieved = await noCacheKeys.get('no-cache');
      expect(retrieved).toEqual(secret);
    });
  });

  describe('Validation', () => {
    it('should throw on invalid key data when throwOnInvalid is true', async () => {
      const strictKeys = new KeyPersistence({
        storage,
        throwOnInvalid: true,
      });

      // Store invalid data directly in storage
      await storage.set('invalid', '{"type":"unknown","kid":"invalid"}');

      await expect(strictKeys.get('invalid')).rejects.toThrow();
    });

    it('should return null on invalid key data when throwOnInvalid is false', async () => {
      // Store invalid data directly in storage
      await storage.set('invalid', '{"type":"unknown","kid":"invalid"}');

      const result = await keys.get('invalid');
      expect(result).toBeNull();
    });

    it('should throw when setting invalid key data', async () => {
      const invalidKey = {
        type: 'unknown',
        kid: 'bad-key',
        createdAt: Date.now(),
        version: 1,
      };

      await expect(keys.set(invalidKey as any)).rejects.toThrow();
    });

    it('should reject key with future createdAt', async () => {
      const futureKey: SecretKeyData = {
        type: 'secret',
        kid: 'future-key',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now() + 100000000, // Far in the future
        version: 1,
      };

      await expect(keys.set(futureKey)).rejects.toThrow('future');
    });
  });

  describe('Storage Adapter Access', () => {
    it('should provide access to underlying adapter', () => {
      const adapter = keys.getAdapter();
      expect(adapter).toBe(storage);
    });
  });
});

describe('Schema Validation', () => {
  describe('validateKeyData', () => {
    it('should validate a valid secret key', () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now(),
        version: 1,
      };

      const result = validateKeyData(secret);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(secret);
    });

    it('should validate a valid asymmetric key', () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'test',
        alg: 'RS256',
        privateKey: { kty: 'RSA' },
        publicJwk: { keys: [{ kty: 'RSA' }] },
        createdAt: Date.now(),
        version: 1,
      };

      const result = validateKeyData(asymmetric);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(asymmetric);
    });

    it('should reject invalid key type', () => {
      const invalid = {
        type: 'invalid',
        kid: 'test',
        createdAt: Date.now(),
        version: 1,
      };

      const result = validateKeyData(invalid);
      expect(result.valid).toBe(false);
    });

    it('should reject missing required fields', () => {
      const incomplete = {
        type: 'secret',
        kid: 'test',
      };

      const result = validateKeyData(incomplete);
      expect(result.valid).toBe(false);
    });

    it('should reject createdAt in the future', () => {
      const future: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now() + 100000000,
        version: 1,
      };

      const result = validateKeyData(future);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('future');
    });

    it('should allow slight clock drift', () => {
      const slightFuture: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now() + 30000, // 30 seconds in future (within 1 min drift)
        version: 1,
      };

      const result = validateKeyData(slightFuture);
      expect(result.valid).toBe(true);
    });
  });

  describe('parseKeyData', () => {
    it('should return parsed data for valid key', () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now(),
        version: 1,
      };

      const result = parseKeyData(secret);
      expect(result).toEqual(secret);
    });

    it('should return null for invalid key', () => {
      const result = parseKeyData({ type: 'invalid' });
      expect(result).toBeNull();
    });
  });

  describe('isSecretKeyData', () => {
    it('should return true for secret key', () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now(),
        version: 1,
      };

      expect(isSecretKeyData(secret)).toBe(true);
    });

    it('should return false for asymmetric key', () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'test',
        alg: 'RS256',
        privateKey: { kty: 'RSA' },
        publicJwk: { keys: [{ kty: 'RSA' }] },
        createdAt: Date.now(),
        version: 1,
      };

      expect(isSecretKeyData(asymmetric)).toBe(false);
    });
  });

  describe('isAsymmetricKeyData', () => {
    it('should return true for asymmetric key', () => {
      const asymmetric: AsymmetricKeyData = {
        type: 'asymmetric',
        kid: 'test',
        alg: 'ES256',
        privateKey: { kty: 'EC' },
        publicJwk: { keys: [{ kty: 'EC' }] },
        createdAt: Date.now(),
        version: 1,
      };

      expect(isAsymmetricKeyData(asymmetric)).toBe(true);
    });

    it('should return false for secret key', () => {
      const secret: SecretKeyData = {
        type: 'secret',
        kid: 'test',
        secret: 'abc',
        bytes: 3,
        createdAt: Date.now(),
        version: 1,
      };

      expect(isAsymmetricKeyData(secret)).toBe(false);
    });
  });
});

describe('Factory Functions', () => {
  describe('createKeyPersistence', () => {
    it('should create KeyPersistence with memory storage', async () => {
      const keys = await createKeyPersistence({ type: 'memory' });

      const secret = await keys.getOrCreateSecret('test');
      expect(secret.type).toBe('secret');

      await keys.getAdapter().disconnect();
    });

    it('should create KeyPersistence with filesystem storage', async () => {
      const testDir = await mkdtemp(path.join(os.tmpdir(), 'keypersist-test-'));

      try {
        const keys = await createKeyPersistence({
          type: 'filesystem',
          baseDir: testDir,
        });

        const secret = await keys.getOrCreateSecret('fs-test');
        expect(secret.type).toBe('secret');

        // Verify persistence
        const keys2 = await createKeyPersistence({
          type: 'filesystem',
          baseDir: testDir,
        });
        const retrieved = await keys2.getSecret('fs-test');
        expect(retrieved).toEqual(secret);

        await keys.getAdapter().disconnect();
        await keys2.getAdapter().disconnect();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('should auto-detect storage type (Node.js = filesystem)', async () => {
      const testDir = await mkdtemp(path.join(os.tmpdir(), 'keypersist-auto-'));

      try {
        const keys = await createKeyPersistence({
          baseDir: testDir,
        });

        // In Node.js, should use filesystem
        expect(keys.getAdapter()).toBeInstanceOf(FileSystemStorageAdapter);

        await keys.getAdapter().disconnect();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('createKeyPersistenceWithStorage', () => {
    it('should create KeyPersistence with provided adapter', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.connect();

      const keys = createKeyPersistenceWithStorage(adapter);

      const secret = await keys.getOrCreateSecret('custom-storage');
      expect(secret.type).toBe('secret');

      await adapter.disconnect();
    });

    it('should pass through options', async () => {
      const adapter = new MemoryStorageAdapter();
      await adapter.connect();

      const keys = createKeyPersistenceWithStorage(adapter, {
        enableCache: false,
        throwOnInvalid: true,
      });

      // Verify cache is disabled
      await keys.set({
        type: 'secret',
        kid: 'no-cache',
        secret: 'test',
        bytes: 4,
        createdAt: Date.now(),
        version: 1,
      });
      expect(keys.isCached('no-cache')).toBe(false);

      await adapter.disconnect();
    });
  });
});
