/**
 * Dev Key Persistence Tests
 */
import * as path from 'path';
import * as os from 'os';
import { mkdtemp, rm, writeFile, stat, readFile, readdir, access } from '@frontmcp/utils';
import {
  DevKeyData,
  DevKeyPersistenceOptions,
  isDevKeyPersistenceEnabled,
  resolveKeyPath,
  loadDevKey,
  saveDevKey,
  deleteDevKey,
} from '../dev-key-persistence';

describe('Dev Key Persistence', () => {
  let tempDir: string;
  let originalNodeEnv: string | undefined;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'dev-key-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalNodeEnv = process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env['NODE_ENV'] = originalNodeEnv;
    } else {
      delete process.env['NODE_ENV'];
    }
  });

  describe('isDevKeyPersistenceEnabled', () => {
    it('should be enabled in development by default', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isDevKeyPersistenceEnabled()).toBe(true);
    });

    it('should be enabled when NODE_ENV is not set', () => {
      delete process.env['NODE_ENV'];
      expect(isDevKeyPersistenceEnabled()).toBe(true);
    });

    it('should be disabled in production by default', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isDevKeyPersistenceEnabled()).toBe(false);
    });

    it('should be enabled in production with forceEnable', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isDevKeyPersistenceEnabled({ forceEnable: true })).toBe(true);
    });

    it('should be enabled in development even without forceEnable', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isDevKeyPersistenceEnabled({ forceEnable: false })).toBe(true);
    });
  });

  describe('resolveKeyPath', () => {
    it('should return default path when no options provided', () => {
      const result = resolveKeyPath();
      expect(result).toBe(path.resolve(process.cwd(), '.frontmcp/dev-keys.json'));
    });

    it('should return custom path when provided', () => {
      const result = resolveKeyPath({ keyPath: 'custom/path/keys.json' });
      expect(result).toBe(path.resolve(process.cwd(), 'custom/path/keys.json'));
    });

    it('should preserve absolute path', () => {
      const absolutePath = '/absolute/path/to/keys.json';
      const result = resolveKeyPath({ keyPath: absolutePath });
      expect(result).toBe(absolutePath);
    });
  });

  describe('loadDevKey', () => {
    it('should return null when persistence is disabled', async () => {
      process.env['NODE_ENV'] = 'production';
      const result = await loadDevKey();
      expect(result).toBeNull();
    });

    it('should return null when file does not exist', async () => {
      process.env['NODE_ENV'] = 'development';
      const result = await loadDevKey({ keyPath: path.join(tempDir, 'nonexistent.json') });
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'invalid.json');
      await writeFile(keyPath, 'not valid json');

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should return null for invalid key structure', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'invalid-structure.json');
      await writeFile(keyPath, JSON.stringify({ invalid: 'structure' }));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should load valid key data', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'valid-key.json');
      const validKeyData: DevKeyData = {
        kid: 'test-kid-123',
        privateKey: {
          kty: 'RSA',
          n: 'test-modulus',
          e: 'AQAB',
          d: 'test-private-exponent',
        },
        publicJwk: {
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid-123',
              alg: 'RS256',
              use: 'sig',
              n: 'test-modulus',
              e: 'AQAB',
            } as any,
          ],
        },
        createdAt: Date.now() - 1000,
        alg: 'RS256',
      };

      await writeFile(keyPath, JSON.stringify(validKeyData));

      const result = await loadDevKey({ keyPath });
      expect(result).toEqual(validKeyData);
    });

    it('should reject key with mismatched kid', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'mismatched-kid.json');
      const keyData = {
        kid: 'top-level-kid',
        privateKey: {
          kty: 'RSA',
          n: 'test-modulus',
          e: 'AQAB',
          d: 'test-private-exponent',
        },
        publicJwk: {
          keys: [
            {
              kty: 'RSA',
              kid: 'different-kid',
              alg: 'RS256',
              use: 'sig',
              n: 'test-modulus',
              e: 'AQAB',
            },
          ],
        },
        createdAt: Date.now() - 1000,
        alg: 'RS256',
      };

      await writeFile(keyPath, JSON.stringify(keyData));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject key with mismatched algorithm', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'mismatched-alg.json');
      const keyData = {
        kid: 'test-kid',
        privateKey: {
          kty: 'EC', // EC key but RS256 alg
          crv: 'P-256',
          x: 'test-x',
          y: 'test-y',
          d: 'test-d',
        },
        publicJwk: {
          keys: [
            {
              kty: 'EC',
              kid: 'test-kid',
              alg: 'RS256', // Should be ES256
              use: 'sig',
            },
          ],
        },
        createdAt: Date.now() - 1000,
        alg: 'RS256', // Claims RS256 but has EC key
      };

      await writeFile(keyPath, JSON.stringify(keyData));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject key with future createdAt', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'future-key.json');
      const keyData = {
        kid: 'test-kid',
        privateKey: {
          kty: 'RSA',
          n: 'test-modulus',
          e: 'AQAB',
          d: 'test-private-exponent',
        },
        publicJwk: {
          keys: [
            {
              kty: 'RSA',
              kid: 'test-kid',
              alg: 'RS256',
              use: 'sig',
              n: 'test-modulus',
              e: 'AQAB',
            },
          ],
        },
        createdAt: Date.now() + 1000000, // Future
        alg: 'RS256',
      };

      await writeFile(keyPath, JSON.stringify(keyData));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });
  });

  describe('saveDevKey', () => {
    it('should return true when persistence is disabled', async () => {
      process.env['NODE_ENV'] = 'production';
      const keyData: DevKeyData = {
        kid: 'test',
        privateKey: { kty: 'RSA', n: 'n', e: 'e', d: 'd' },
        publicJwk: { keys: [{ kty: 'RSA', kid: 'test', alg: 'RS256', use: 'sig' } as any] },
        createdAt: Date.now(),
        alg: 'RS256',
      };

      const result = await saveDevKey(keyData);
      expect(result).toBe(true);
    });

    it('should save key to file', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'saved-key.json');
      const keyData: DevKeyData = {
        kid: 'saved-kid',
        privateKey: { kty: 'RSA', n: 'n', e: 'AQAB', d: 'd' },
        publicJwk: { keys: [{ kty: 'RSA', kid: 'saved-kid', alg: 'RS256', use: 'sig' } as any] },
        createdAt: Date.now() - 1000,
        alg: 'RS256',
      };

      const result = await saveDevKey(keyData, { keyPath });
      expect(result).toBe(true);

      // Verify file was created
      const content = await readFile(keyPath, 'utf8');
      expect(JSON.parse(content)).toEqual(keyData);
    });

    it('should create directory if it does not exist', async () => {
      process.env['NODE_ENV'] = 'development';
      const subDir = path.join(tempDir, 'new-dir', 'subdir');
      const keyPath = path.join(subDir, 'key.json');
      const keyData: DevKeyData = {
        kid: 'new-kid',
        privateKey: { kty: 'RSA', n: 'n', e: 'AQAB', d: 'd' },
        publicJwk: { keys: [{ kty: 'RSA', kid: 'new-kid', alg: 'RS256', use: 'sig' } as any] },
        createdAt: Date.now() - 1000,
        alg: 'RS256',
      };

      const result = await saveDevKey(keyData, { keyPath });
      expect(result).toBe(true);

      // Verify directory was created
      const dirStats = await stat(subDir);
      expect(dirStats.isDirectory()).toBe(true);
    });
  });

  describe('deleteDevKey', () => {
    it('should delete existing key file', async () => {
      const keyPath = path.join(tempDir, 'to-delete.json');
      await writeFile(keyPath, JSON.stringify({ test: 'data' }));

      // Verify file exists
      const existsBefore = await access(keyPath)
        .then(() => true)
        .catch(() => false);
      expect(existsBefore).toBe(true);

      await deleteDevKey({ keyPath });

      // Verify file is deleted
      const existsAfter = await access(keyPath)
        .then(() => true)
        .catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('should not throw when file does not exist', async () => {
      const keyPath = path.join(tempDir, 'nonexistent-delete.json');

      // Should not throw
      await expect(deleteDevKey({ keyPath })).resolves.not.toThrow();
    });
  });

  describe('round-trip', () => {
    it('should save and load key successfully', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'roundtrip-key.json');
      const keyData: DevKeyData = {
        kid: 'roundtrip-kid',
        privateKey: {
          kty: 'RSA',
          n: 'test-modulus-value',
          e: 'AQAB',
          d: 'test-private-exponent',
        },
        publicJwk: {
          keys: [
            {
              kty: 'RSA',
              kid: 'roundtrip-kid',
              alg: 'RS256',
              use: 'sig',
              n: 'test-modulus-value',
              e: 'AQAB',
            } as any,
          ],
        },
        createdAt: Date.now() - 1000,
        alg: 'RS256',
      };

      // Save
      const saveResult = await saveDevKey(keyData, { keyPath });
      expect(saveResult).toBe(true);

      // Load
      const loadResult = await loadDevKey({ keyPath });
      expect(loadResult).toEqual(keyData);

      // Delete
      await deleteDevKey({ keyPath });

      // Verify deleted
      const afterDelete = await loadDevKey({ keyPath });
      expect(afterDelete).toBeNull();
    });

    it('should work with EC keys', async () => {
      process.env['NODE_ENV'] = 'development';
      const keyPath = path.join(tempDir, 'ec-roundtrip-key.json');
      const keyData: DevKeyData = {
        kid: 'ec-kid',
        privateKey: {
          kty: 'EC',
          crv: 'P-256',
          x: 'test-x-coordinate',
          y: 'test-y-coordinate',
          d: 'test-private-key',
        },
        publicJwk: {
          keys: [
            {
              kty: 'EC',
              kid: 'ec-kid',
              alg: 'ES256',
              use: 'sig',
              crv: 'P-256',
              x: 'test-x-coordinate',
              y: 'test-y-coordinate',
            } as any,
          ],
        },
        createdAt: Date.now() - 1000,
        alg: 'ES256',
      };

      // Save
      const saveResult = await saveDevKey(keyData, { keyPath });
      expect(saveResult).toBe(true);

      // Load
      const loadResult = await loadDevKey({ keyPath });
      expect(loadResult).toEqual(keyData);
    });
  });
});
