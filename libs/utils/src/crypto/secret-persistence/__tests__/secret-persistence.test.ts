import * as path from 'path';
import * as os from 'os';
import { mkdtemp, rm, writeFile, access } from '../../../fs';
import {
  isSecretPersistenceEnabled,
  resolveSecretPath,
  loadSecret,
  saveSecret,
  deleteSecret,
  generateSecret,
  createSecretData,
  getOrCreateSecret,
  clearCachedSecret,
  isSecretCached,
  validateSecretData,
  secretDataSchema,
  parseSecretData,
} from '../index';
import type { SecretData } from '../types';

describe('Secret Persistence', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    // Create temp directory for tests
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'secret-persistence-test-'));
  });

  afterAll(async () => {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env['NODE_ENV'];
    // Clear all cached secrets
    clearCachedSecret();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isSecretPersistenceEnabled', () => {
    it('should be enabled in development by default', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isSecretPersistenceEnabled()).toBe(true);
    });

    it('should be enabled when NODE_ENV is not set', () => {
      delete process.env['NODE_ENV'];
      expect(isSecretPersistenceEnabled()).toBe(true);
    });

    it('should be disabled in production by default', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled()).toBe(false);
    });

    it('should be enabled in production with forceEnable', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled({ forceEnable: true })).toBe(true);
    });

    it('should be disabled in production when forceEnable is false', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled({ forceEnable: false })).toBe(false);
    });
  });

  describe('resolveSecretPath', () => {
    it('should use default path with default name', () => {
      const resolved = resolveSecretPath();
      expect(resolved).toContain('.frontmcp');
      expect(resolved).toContain('default-secret.json');
    });

    it('should use custom name in default path', () => {
      const resolved = resolveSecretPath({ name: 'remember' });
      expect(resolved).toContain('remember-secret.json');
    });

    it('should use custom secretPath', () => {
      const customPath = path.join(tempDir, 'custom-secret.json');
      const resolved = resolveSecretPath({ secretPath: customPath });
      expect(resolved).toBe(customPath);
    });

    it('should resolve relative secretPath from cwd', () => {
      const resolved = resolveSecretPath({ secretPath: 'relative/path.json' });
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toContain('relative/path.json');
    });

    it('should use absolute secretPath as-is', () => {
      const absolutePath = '/absolute/path/secret.json';
      const resolved = resolveSecretPath({ secretPath: absolutePath });
      expect(resolved).toBe(absolutePath);
    });
  });

  describe('generateSecret', () => {
    it('should generate base64url-encoded secret', () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[A-Za-z0-9\-_]+$/);
    });

    it('should generate secret with default length', () => {
      const secret = generateSecret();
      // 32 bytes = ~43 base64url chars
      expect(secret.length).toBeGreaterThanOrEqual(40);
      expect(secret.length).toBeLessThanOrEqual(50);
    });

    it('should generate secret with custom length', () => {
      const secret = generateSecret(64);
      // 64 bytes = ~86 base64url chars
      expect(secret.length).toBeGreaterThanOrEqual(80);
    });

    it('should generate unique secrets', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        secrets.add(generateSecret());
      }
      expect(secrets.size).toBe(100);
    });
  });

  describe('createSecretData', () => {
    it('should create secret data with defaults', () => {
      const data = createSecretData();
      expect(data.secret).toBeDefined();
      expect(data.createdAt).toBeGreaterThan(0);
      expect(data.version).toBe(1);
    });

    it('should create secret data with custom bytes', () => {
      const data = createSecretData({ secretBytes: 64 });
      expect(data.secret.length).toBeGreaterThanOrEqual(80);
    });

    it('should create recent timestamp', () => {
      const before = Date.now();
      const data = createSecretData();
      const after = Date.now();
      expect(data.createdAt).toBeGreaterThanOrEqual(before);
      expect(data.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('validateSecretData', () => {
    it('should validate correct secret data', () => {
      const data = createSecretData();
      const result = validateSecretData(data);
      expect(result.valid).toBe(true);
    });

    it('should reject missing secret', () => {
      const result = validateSecretData({ createdAt: Date.now(), version: 1 });
      expect(result.valid).toBe(false);
    });

    // Valid base64url string of 43 chars (represents 32 bytes)
    const validBase64urlSecret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop0';

    it('should reject missing createdAt', () => {
      const result = validateSecretData({ secret: validBase64urlSecret, version: 1 });
      expect(result.valid).toBe(false);
    });

    it('should reject missing version', () => {
      const result = validateSecretData({ secret: validBase64urlSecret, createdAt: Date.now() });
      expect(result.valid).toBe(false);
    });

    it('should reject future createdAt', () => {
      const futureTime = Date.now() + 120000; // 2 minutes in future
      const result = validateSecretData({
        secret: validBase64urlSecret,
        createdAt: futureTime,
        version: 1,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('future');
    });

    it('should allow small clock drift', () => {
      const slightlyFuture = Date.now() + 30000; // 30 seconds in future
      const result = validateSecretData({
        secret: validBase64urlSecret,
        createdAt: slightlyFuture,
        version: 1,
      });
      expect(result.valid).toBe(true);
    });

    // Note: The "too old" check (100 years) can't be triggered with positive timestamps
    // until approximately year 2070, since Unix epoch started in 1970.
    // This is intentional - it's a sanity check for corrupted data, not a real use case.

    it('should reject short secret', () => {
      const result = validateSecretData({ secret: 'short', createdAt: Date.now(), version: 1 });
      expect(result.valid).toBe(false);
    });
  });

  describe('parseSecretData', () => {
    it('should parse valid secret data', () => {
      const data = createSecretData();
      const parsed = parseSecretData(data);
      expect(parsed).not.toBeNull();
      expect(parsed?.secret).toBe(data.secret);
    });

    it('should return null for invalid data', () => {
      const parsed = parseSecretData({ invalid: true });
      expect(parsed).toBeNull();
    });
  });

  describe('secretDataSchema', () => {
    it('should parse valid data', () => {
      const data = createSecretData();
      const result = secretDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid data', () => {
      const result = secretDataSchema.safeParse({ invalid: true });
      expect(result.success).toBe(false);
    });
  });

  describe('saveSecret and loadSecret', () => {
    it('should save and load secret', async () => {
      const secretPath = path.join(tempDir, 'test-save-load.json');
      const data = createSecretData();

      const saved = await saveSecret(data, { secretPath, enableLogging: false });
      expect(saved).toBe(true);

      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).not.toBeNull();
      expect(loaded?.secret).toBe(data.secret);
      expect(loaded?.createdAt).toBe(data.createdAt);
    });

    it('should return null when file does not exist', async () => {
      const secretPath = path.join(tempDir, 'nonexistent.json');
      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });

    it('should create directory if needed', async () => {
      const secretPath = path.join(tempDir, 'new-dir', 'nested', 'secret.json');
      const data = createSecretData();

      const saved = await saveSecret(data, { secretPath, enableLogging: false });
      expect(saved).toBe(true);

      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded?.secret).toBe(data.secret);
    });

    it('should return null for invalid JSON', async () => {
      const secretPath = path.join(tempDir, 'invalid.json');
      await writeFile(secretPath, 'not json');

      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });

    it('should return null for invalid structure', async () => {
      const secretPath = path.join(tempDir, 'invalid-structure.json');
      await writeFile(secretPath, JSON.stringify({ wrong: 'structure' }));

      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });

    it('should not save when persistence disabled', async () => {
      process.env['NODE_ENV'] = 'production';
      const secretPath = path.join(tempDir, 'should-not-exist.json');
      const data = createSecretData();

      const saved = await saveSecret(data, { secretPath, enableLogging: false });
      expect(saved).toBe(true); // Returns true (not a failure)

      // But file should not exist
      await expect(access(secretPath)).rejects.toThrow(/ENOENT/);
    });

    it('should not load when persistence disabled', async () => {
      // First save in non-production
      const secretPath = path.join(tempDir, 'exists-but-disabled.json');
      const data = createSecretData();
      await saveSecret(data, { secretPath, enableLogging: false });

      // Now try to load in production
      process.env['NODE_ENV'] = 'production';
      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });
  });

  describe('deleteSecret', () => {
    it('should delete existing secret', async () => {
      const secretPath = path.join(tempDir, 'to-delete.json');
      const data = createSecretData();
      await saveSecret(data, { secretPath, enableLogging: false });

      const deleted = await deleteSecret({ secretPath, enableLogging: false });
      expect(deleted).toBe(true);

      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });

    it('should return true for non-existent file', async () => {
      const secretPath = path.join(tempDir, 'does-not-exist.json');
      const deleted = await deleteSecret({ secretPath, enableLogging: false });
      expect(deleted).toBe(true);
    });
  });

  describe('getOrCreateSecret', () => {
    it('should create new secret if none exists', async () => {
      const secretPath = path.join(tempDir, 'new-secret.json');
      clearCachedSecret({ secretPath });

      const secret = await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(secret).toBeDefined();
      expect(secret.length).toBeGreaterThan(30);
    });

    it('should load existing secret', async () => {
      const secretPath = path.join(tempDir, 'existing-secret.json');
      const data = createSecretData();
      await saveSecret(data, { secretPath, enableLogging: false });
      clearCachedSecret({ secretPath });

      const secret = await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(secret).toBe(data.secret);
    });

    it('should cache secret after first call', async () => {
      const secretPath = path.join(tempDir, 'cached-secret.json');
      clearCachedSecret({ secretPath });

      const secret1 = await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(isSecretCached({ secretPath })).toBe(true);

      const secret2 = await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(secret2).toBe(secret1);
    });

    it('should handle concurrent calls', async () => {
      const secretPath = path.join(tempDir, 'concurrent-secret.json');
      clearCachedSecret({ secretPath });

      // Make multiple concurrent calls
      const promises = Array(10)
        .fill(null)
        .map(() => getOrCreateSecret({ secretPath, enableLogging: false }));

      const secrets = await Promise.all(promises);

      // All should return the same secret
      const uniqueSecrets = new Set(secrets);
      expect(uniqueSecrets.size).toBe(1);
    });
  });

  describe('isSecretCached', () => {
    it('should return false before secret is loaded', () => {
      const secretPath = path.join(tempDir, 'not-cached.json');
      clearCachedSecret({ secretPath });
      expect(isSecretCached({ secretPath })).toBe(false);
    });

    it('should return true after secret is loaded', async () => {
      const secretPath = path.join(tempDir, 'will-be-cached.json');
      clearCachedSecret({ secretPath });

      await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(isSecretCached({ secretPath })).toBe(true);
    });
  });

  describe('clearCachedSecret', () => {
    it('should clear specific cached secret', async () => {
      const secretPath = path.join(tempDir, 'clear-specific.json');
      await getOrCreateSecret({ secretPath, enableLogging: false });
      expect(isSecretCached({ secretPath })).toBe(true);

      clearCachedSecret({ secretPath });
      expect(isSecretCached({ secretPath })).toBe(false);
    });

    it('should clear all cached secrets', async () => {
      const path1 = path.join(tempDir, 'clear-all-1.json');
      const path2 = path.join(tempDir, 'clear-all-2.json');

      await getOrCreateSecret({ secretPath: path1, enableLogging: false });
      await getOrCreateSecret({ secretPath: path2, enableLogging: false });

      clearCachedSecret(); // No options = clear all

      expect(isSecretCached({ secretPath: path1 })).toBe(false);
      expect(isSecretCached({ secretPath: path2 })).toBe(false);
    });
  });

  describe('custom logging', () => {
    it('should use custom logger', async () => {
      const warnings: string[] = [];
      const errors: string[] = [];
      const customLogger = {
        warn: (msg: string) => warnings.push(msg),
        error: (msg: string) => errors.push(msg),
      };

      const secretPath = path.join(tempDir, 'invalid-for-logging.json');
      await writeFile(secretPath, 'not json');

      await loadSecret({ secretPath, logger: customLogger });

      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should suppress logging with enableLogging: false', async () => {
      const secretPath = path.join(tempDir, 'no-logging.json');
      await writeFile(secretPath, 'not json');

      // This should not throw or log
      const loaded = await loadSecret({ secretPath, enableLogging: false });
      expect(loaded).toBeNull();
    });
  });
});
