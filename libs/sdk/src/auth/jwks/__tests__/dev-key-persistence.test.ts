/**
 * Dev Key Persistence Tests
 *
 * Tests for the development key persistence system used for JWT signing.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-key-test-'));
  });

  afterAll(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    originalNodeEnv = process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV'];
    } else {
      process.env['NODE_ENV'] = originalNodeEnv;
    }
  });

  // ============================================
  // Environment Detection Tests
  // ============================================

  describe('isDevKeyPersistenceEnabled', () => {
    it('should return true in development by default', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isDevKeyPersistenceEnabled()).toBe(true);
    });

    it('should return true when NODE_ENV is not set', () => {
      delete process.env['NODE_ENV'];
      expect(isDevKeyPersistenceEnabled()).toBe(true);
    });

    it('should return false in production by default', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isDevKeyPersistenceEnabled()).toBe(false);
    });

    it('should return true in production with forceEnable', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isDevKeyPersistenceEnabled({ forceEnable: true })).toBe(true);
    });

    it('should return true in development even without forceEnable', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isDevKeyPersistenceEnabled({ forceEnable: false })).toBe(true);
    });
  });

  // ============================================
  // Path Resolution Tests
  // ============================================

  describe('resolveKeyPath', () => {
    it('should use default path when no options provided', () => {
      const result = resolveKeyPath();
      expect(result).toBe(path.resolve(process.cwd(), '.frontmcp/dev-keys.json'));
    });

    it('should use custom relative path', () => {
      const result = resolveKeyPath({ keyPath: 'custom/keys.json' });
      expect(result).toBe(path.resolve(process.cwd(), 'custom/keys.json'));
    });

    it('should use absolute path as-is', () => {
      const absolutePath = '/absolute/path/to/keys.json';
      const result = resolveKeyPath({ keyPath: absolutePath });
      expect(result).toBe(absolutePath);
    });

    it('should handle relative path with ../', () => {
      const result = resolveKeyPath({ keyPath: '../parent/keys.json' });
      expect(result).toBe(path.resolve(process.cwd(), '../parent/keys.json'));
    });
  });

  // ============================================
  // Load Key Tests
  // ============================================

  describe('loadDevKey', () => {
    it('should return null when file does not exist', async () => {
      const options: DevKeyPersistenceOptions = {
        keyPath: path.join(tempDir, 'nonexistent.json'),
      };
      const result = await loadDevKey(options);
      expect(result).toBeNull();
    });

    it('should return null in production without forceEnable', async () => {
      process.env['NODE_ENV'] = 'production';
      const keyPath = path.join(tempDir, 'prod-test.json');

      // Create a valid key file
      const validKey = createValidRsaKeyData();
      await fs.writeFile(keyPath, JSON.stringify(validKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should load valid RS256 key', async () => {
      const keyPath = path.join(tempDir, 'valid-rs256.json');
      const validKey = createValidRsaKeyData();
      await fs.writeFile(keyPath, JSON.stringify(validKey));

      const result = await loadDevKey({ keyPath });
      expect(result).not.toBeNull();
      expect(result?.kid).toBe(validKey.kid);
      expect(result?.alg).toBe('RS256');
    });

    it('should load valid ES256 key', async () => {
      const keyPath = path.join(tempDir, 'valid-es256.json');
      const validKey = createValidEcKeyData();
      await fs.writeFile(keyPath, JSON.stringify(validKey));

      const result = await loadDevKey({ keyPath });
      expect(result).not.toBeNull();
      expect(result?.kid).toBe(validKey.kid);
      expect(result?.alg).toBe('ES256');
    });

    it('should return null for empty file', async () => {
      const keyPath = path.join(tempDir, 'empty.json');
      await fs.writeFile(keyPath, '');

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      const keyPath = path.join(tempDir, 'invalid-json.json');
      await fs.writeFile(keyPath, 'not valid json {{{');

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should return null for JSON with just {}', async () => {
      const keyPath = path.join(tempDir, 'empty-object.json');
      await fs.writeFile(keyPath, '{}');

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should return null for JSON with null', async () => {
      const keyPath = path.join(tempDir, 'null.json');
      await fs.writeFile(keyPath, 'null');

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });
  });

  // ============================================
  // Validation Tests
  // ============================================

  describe('JWK Structure Validation', () => {
    it('should reject missing kid', async () => {
      const keyPath = path.join(tempDir, 'missing-kid.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey as Record<string, unknown>)['kid'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject missing privateKey', async () => {
      const keyPath = path.join(tempDir, 'missing-private.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey as Record<string, unknown>)['privateKey'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject missing publicJwk', async () => {
      const keyPath = path.join(tempDir, 'missing-public.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey as Record<string, unknown>)['publicJwk'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject missing createdAt', async () => {
      const keyPath = path.join(tempDir, 'missing-created.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey as Record<string, unknown>)['createdAt'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject missing alg', async () => {
      const keyPath = path.join(tempDir, 'missing-alg.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey as Record<string, unknown>)['alg'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject invalid alg (HS256)', async () => {
      const keyPath = path.join(tempDir, 'invalid-alg-hs256.json');
      const invalidKey = createValidRsaKeyData();
      (invalidKey as Record<string, unknown>)['alg'] = 'HS256';
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject invalid alg (none)', async () => {
      const keyPath = path.join(tempDir, 'invalid-alg-none.json');
      const invalidKey = createValidRsaKeyData();
      (invalidKey as Record<string, unknown>)['alg'] = 'none';
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject empty keys array in publicJwk', async () => {
      const keyPath = path.join(tempDir, 'empty-keys.json');
      const invalidKey = createValidRsaKeyData();
      invalidKey.publicJwk.keys = [];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject publicJwk without keys array', async () => {
      const keyPath = path.join(tempDir, 'no-keys-array.json');
      const invalidKey = createValidRsaKeyData();
      (invalidKey.publicJwk as Record<string, unknown>) = {};
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject negative timestamp', async () => {
      const keyPath = path.join(tempDir, 'negative-timestamp.json');
      const invalidKey = createValidRsaKeyData();
      invalidKey.createdAt = -1;
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject future timestamp (year 3000)', async () => {
      const keyPath = path.join(tempDir, 'future-timestamp.json');
      const invalidKey = createValidRsaKeyData();
      invalidKey.createdAt = new Date('3000-01-01').getTime();
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject RS256 with EC key type', async () => {
      const keyPath = path.join(tempDir, 'rs256-with-ec.json');
      const invalidKey = createValidEcKeyData();
      invalidKey.alg = 'RS256';
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject ES256 with RSA key type', async () => {
      const keyPath = path.join(tempDir, 'es256-with-rsa.json');
      const invalidKey = createValidRsaKeyData();
      invalidKey.alg = 'ES256';
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject mismatched public/private key types', async () => {
      const keyPath = path.join(tempDir, 'mismatched-types.json');
      const rsaKey = createValidRsaKeyData();
      const ecKey = createValidEcKeyData();
      // Use RSA private key with EC public key
      rsaKey.publicJwk = ecKey.publicJwk;
      await fs.writeFile(keyPath, JSON.stringify(rsaKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject RSA key missing n', async () => {
      const keyPath = path.join(tempDir, 'rsa-missing-n.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['n'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject RSA key missing e', async () => {
      const keyPath = path.join(tempDir, 'rsa-missing-e.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['e'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject RSA key missing d', async () => {
      const keyPath = path.join(tempDir, 'rsa-missing-d.json');
      const invalidKey = createValidRsaKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['d'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject EC key missing x', async () => {
      const keyPath = path.join(tempDir, 'ec-missing-x.json');
      const invalidKey = createValidEcKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['x'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject EC key missing y', async () => {
      const keyPath = path.join(tempDir, 'ec-missing-y.json');
      const invalidKey = createValidEcKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['y'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject EC key missing d (private exponent)', async () => {
      const keyPath = path.join(tempDir, 'ec-missing-d.json');
      const invalidKey = createValidEcKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['d'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });

    it('should reject EC key missing crv', async () => {
      const keyPath = path.join(tempDir, 'ec-missing-crv.json');
      const invalidKey = createValidEcKeyData();
      delete (invalidKey.privateKey as Record<string, unknown>)['crv'];
      await fs.writeFile(keyPath, JSON.stringify(invalidKey));

      const result = await loadDevKey({ keyPath });
      expect(result).toBeNull();
    });
  });

  // ============================================
  // Save Key Tests
  // ============================================

  describe('saveDevKey', () => {
    it('should save valid key to file', async () => {
      const keyPath = path.join(tempDir, 'save-test.json');
      const validKey = createValidRsaKeyData();

      const result = await saveDevKey(validKey, { keyPath });
      expect(result).toBe(true);

      // Verify file exists
      const stat = await fs.stat(keyPath);
      expect(stat.isFile()).toBe(true);
    });

    it('should create parent directories', async () => {
      const keyPath = path.join(tempDir, 'nested', 'deep', 'save-nested.json');
      const validKey = createValidRsaKeyData();

      const result = await saveDevKey(validKey, { keyPath });
      expect(result).toBe(true);

      // Verify file exists
      const stat = await fs.stat(keyPath);
      expect(stat.isFile()).toBe(true);
    });

    it('should set file permissions to 0o600', async () => {
      const keyPath = path.join(tempDir, 'perms-test.json');
      const validKey = createValidRsaKeyData();

      await saveDevKey(validKey, { keyPath });

      const stat = await fs.stat(keyPath);
      // Check owner read/write only (on POSIX systems)
      expect(stat.mode & 0o777).toBe(0o600);
    });

    it('should set directory permissions to 0o700', async () => {
      const keyPath = path.join(tempDir, 'perms-dir', 'keys.json');
      const validKey = createValidRsaKeyData();

      await saveDevKey(validKey, { keyPath });

      const dirStat = await fs.stat(path.dirname(keyPath));
      expect(dirStat.mode & 0o777).toBe(0o700);
    });

    it('should return true in production without saving', async () => {
      process.env['NODE_ENV'] = 'production';
      const keyPath = path.join(tempDir, 'prod-save.json');
      const validKey = createValidRsaKeyData();

      const result = await saveDevKey(validKey, { keyPath });
      expect(result).toBe(true);

      // File should not exist
      await expect(fs.access(keyPath)).rejects.toThrow();
    });

    it('should use atomic write pattern', async () => {
      const keyPath = path.join(tempDir, 'atomic-test.json');
      const validKey = createValidRsaKeyData();

      // Save should not leave temp files
      await saveDevKey(validKey, { keyPath });

      // Check no temp files in directory
      const files = await fs.readdir(path.dirname(keyPath));
      const tempFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tempFiles.length).toBe(0);
    });

    it('should overwrite existing key', async () => {
      const keyPath = path.join(tempDir, 'overwrite-test.json');
      const key1 = createValidRsaKeyData();
      key1.kid = 'key-1';
      const key2 = createValidRsaKeyData();
      key2.kid = 'key-2';

      await saveDevKey(key1, { keyPath });
      await saveDevKey(key2, { keyPath });

      const loaded = await loadDevKey({ keyPath });
      expect(loaded?.kid).toBe('key-2');
    });

    it('should write JSON with 2-space indentation', async () => {
      const keyPath = path.join(tempDir, 'indent-test.json');
      const validKey = createValidRsaKeyData();

      await saveDevKey(validKey, { keyPath });

      const content = await fs.readFile(keyPath, 'utf8');
      // Check for 2-space indentation
      expect(content).toContain('  "kid"');
    });
  });

  // ============================================
  // Delete Key Tests
  // ============================================

  describe('deleteDevKey', () => {
    it('should delete existing key file', async () => {
      const keyPath = path.join(tempDir, 'delete-test.json');
      const validKey = createValidRsaKeyData();
      await saveDevKey(validKey, { keyPath });

      await deleteDevKey({ keyPath });

      // File should not exist
      await expect(fs.access(keyPath)).rejects.toThrow();
    });

    it('should not throw for non-existent file', async () => {
      const keyPath = path.join(tempDir, 'nonexistent-delete.json');

      // Should not throw
      await expect(deleteDevKey({ keyPath })).resolves.not.toThrow();
    });
  });

  // ============================================
  // Round-trip Tests
  // ============================================

  describe('Round-trip', () => {
    it('should round-trip RS256 key correctly', async () => {
      const keyPath = path.join(tempDir, 'roundtrip-rs256.json');
      const originalKey = createValidRsaKeyData();

      await saveDevKey(originalKey, { keyPath });
      const loadedKey = await loadDevKey({ keyPath });

      expect(loadedKey).toEqual(originalKey);
    });

    it('should round-trip ES256 key correctly', async () => {
      const keyPath = path.join(tempDir, 'roundtrip-es256.json');
      const originalKey = createValidEcKeyData();

      await saveDevKey(originalKey, { keyPath });
      const loadedKey = await loadDevKey({ keyPath });

      expect(loadedKey).toEqual(originalKey);
    });
  });
});

// ============================================
// Test Helpers
// ============================================

function createValidRsaKeyData(): DevKeyData {
  return {
    kid: 'test-kid-' + Date.now().toString(16),
    alg: 'RS256',
    privateKey: {
      kty: 'RSA',
      n: 'sXch1QqFNGd9TFZL8VfpwNrFGPmITIm_DnR-OD7w8k0',
      e: 'AQAB',
      d: 'VFCWOqXr8Zv2PNMCaLEqGC0',
      p: '7w9ZWQplGGS',
      q: 'vdR_lPEuZ3Nj',
      dp: 'M9BaGN9T',
      dq: 'F_s9aEQ',
      qi: 'P7mPqWRl',
    },
    publicJwk: {
      keys: [
        {
          kty: 'RSA',
          kid: 'test-kid-' + Date.now().toString(16),
          alg: 'RS256',
          use: 'sig',
          n: 'sXch1QqFNGd9TFZL8VfpwNrFGPmITIm_DnR-OD7w8k0',
          e: 'AQAB',
        },
      ],
    },
    createdAt: Date.now(),
  };
}

function createValidEcKeyData(): DevKeyData {
  return {
    kid: 'test-ec-kid-' + Date.now().toString(16),
    alg: 'ES256',
    privateKey: {
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
      y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      d: 'jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI',
    },
    publicJwk: {
      keys: [
        {
          kty: 'EC',
          kid: 'test-ec-kid-' + Date.now().toString(16),
          alg: 'ES256',
          use: 'sig',
          crv: 'P-256',
          x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
          y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
        },
      ],
    },
    createdAt: Date.now(),
  };
}
