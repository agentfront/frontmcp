// file: plugins/plugin-remember/src/__tests__/remember-secret-persistence.test.ts

import 'reflect-metadata';
import * as path from 'path';

// Define mock functions inside jest.mock factory to avoid hoisting issues
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    rename: jest.fn(),
    unlink: jest.fn(),
    randomBytes: jest.fn().mockReturnValue(Buffer.from('a'.repeat(32))),
    base64urlEncode: jest.fn().mockReturnValue('YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE'),
  };
});

// Import the mocked functions
import { readFile, writeFile, mkdir, rename, unlink, randomBytes, base64urlEncode } from '@frontmcp/utils';

import {
  isSecretPersistenceEnabled,
  resolveSecretPath,
  loadRememberSecret,
  saveRememberSecret,
  deleteRememberSecret,
  getOrCreatePersistedSecret,
  clearCachedSecret,
  type RememberSecretData,
} from '../remember.secret-persistence';

describe('remember.secret-persistence', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCachedSecret();
    process.env = { ...originalEnv };
    (randomBytes as jest.Mock).mockReturnValue(Buffer.from('a'.repeat(32)));
    (base64urlEncode as jest.Mock).mockReturnValue('YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isSecretPersistenceEnabled', () => {
    it('should return true in development by default', () => {
      delete process.env['NODE_ENV'];
      expect(isSecretPersistenceEnabled()).toBe(true);
    });

    it('should return true in non-production by default', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isSecretPersistenceEnabled()).toBe(true);
    });

    it('should return false in production by default', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled()).toBe(false);
    });

    it('should return true in production if forceEnable is true', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled({ forceEnable: true })).toBe(true);
    });

    it('should return false in production if forceEnable is false', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isSecretPersistenceEnabled({ forceEnable: false })).toBe(false);
    });
  });

  describe('resolveSecretPath', () => {
    it('should return default path relative to cwd', () => {
      const result = resolveSecretPath();
      expect(result).toBe(path.resolve(process.cwd(), '.frontmcp/remember-secret.json'));
    });

    it('should use custom path relative to cwd', () => {
      const result = resolveSecretPath({ secretPath: 'custom/secret.json' });
      expect(result).toBe(path.resolve(process.cwd(), 'custom/secret.json'));
    });

    it('should use absolute path as-is', () => {
      const absolutePath = '/absolute/path/secret.json';
      const result = resolveSecretPath({ secretPath: absolutePath });
      expect(result).toBe(absolutePath);
    });
  });

  describe('loadRememberSecret', () => {
    const validSecretData: RememberSecretData = {
      secret: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE',
      createdAt: Date.now() - 1000,
      version: 1,
    };

    it('should return null if persistence is disabled', async () => {
      process.env['NODE_ENV'] = 'production';

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      expect(readFile).not.toHaveBeenCalled();
    });

    it('should return null if file does not exist', async () => {
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      (readFile as jest.Mock).mockRejectedValue(enoentError);

      const result = await loadRememberSecret();

      expect(result).toBeNull();
    });

    it('should return null and warn on read error', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load secret'));
      consoleSpy.mockRestore();
    });

    it('should return valid secret data', async () => {
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(validSecretData));

      const result = await loadRememberSecret();

      expect(result).toEqual(validSecretData);
    });

    it('should return null for invalid JSON', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (readFile as jest.Mock).mockResolvedValue('invalid-json{');

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return null for invalid schema (missing secret)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({ createdAt: Date.now(), version: 1 }));

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid secret file format'));
      consoleSpy.mockRestore();
    });

    it('should return null for invalid schema (wrong version)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify({ ...validSecretData, version: 2 }));

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return null for future createdAt', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          ...validSecretData,
          createdAt: Date.now() + 120000, // 2 minutes in future
        }),
      );

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('createdAt is in the future'));
      consoleSpy.mockRestore();
    });

    it('should return null for too old createdAt (negative timestamp)', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      // Use a negative timestamp to trigger the "too old" validation
      // This tests the scenario where a corrupted timestamp is detected
      (readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({
          ...validSecretData,
          createdAt: -1000, // Invalid negative timestamp
        }),
      );

      const result = await loadRememberSecret();

      expect(result).toBeNull();
      // Zod validates createdAt must be positive, so the error message reflects that
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid secret file format'));
      consoleSpy.mockRestore();
    });
  });

  describe('saveRememberSecret', () => {
    const validSecretData: RememberSecretData = {
      secret: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE',
      createdAt: Date.now(),
      version: 1,
    };

    it('should return true if persistence is disabled', async () => {
      process.env['NODE_ENV'] = 'production';

      const result = await saveRememberSecret(validSecretData);

      expect(result).toBe(true);
      expect(mkdir).not.toHaveBeenCalled();
    });

    it('should save secret with atomic write', async () => {
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (rename as jest.Mock).mockResolvedValue(undefined);

      const result = await saveRememberSecret(validSecretData);

      expect(result).toBe(true);
      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true, mode: 0o700 });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp.'),
        JSON.stringify(validSecretData, null, 2),
        { mode: 0o600 },
      );
      expect(rename).toHaveBeenCalled();
    });

    it('should return false on mkdir error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (mkdir as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      const result = await saveRememberSecret(validSecretData);

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to save secret'));
      consoleSpy.mockRestore();
    });

    it('should clean up temp file on error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockRejectedValue(new Error('Write failed'));
      (unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await saveRememberSecret(validSecretData);

      expect(result).toBe(false);
      expect(unlink).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should ignore cleanup errors', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockRejectedValue(new Error('Write failed'));
      (unlink as jest.Mock).mockRejectedValue(new Error('Unlink failed'));

      const result = await saveRememberSecret(validSecretData);

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('deleteRememberSecret', () => {
    it('should delete secret file', async () => {
      (unlink as jest.Mock).mockResolvedValue(undefined);

      await deleteRememberSecret();

      expect(unlink).toHaveBeenCalled();
    });

    it('should ignore ENOENT error', async () => {
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      (unlink as jest.Mock).mockRejectedValue(enoentError);

      await expect(deleteRememberSecret()).resolves.not.toThrow();
    });

    it('should warn on other errors', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      (unlink as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await deleteRememberSecret();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to delete secret'));
      consoleSpy.mockRestore();
    });
  });

  describe('getOrCreatePersistedSecret', () => {
    const validSecretData: RememberSecretData = {
      secret: 'loaded-secret-from-file-abcdefghijklmnopqrs', // min 32 chars
      createdAt: Date.now() - 1000,
      version: 1,
    };

    beforeEach(() => {
      clearCachedSecret();
    });

    it('should return cached secret if available', async () => {
      // First call to populate cache
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(validSecretData));
      const first = await getOrCreatePersistedSecret();

      // Reset mock to verify it's not called again
      (readFile as jest.Mock).mockClear();

      const second = await getOrCreatePersistedSecret();

      expect(first).toBe(second);
      expect(readFile).not.toHaveBeenCalled();
    });

    it('should load existing secret from file', async () => {
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(validSecretData));

      const result = await getOrCreatePersistedSecret();

      expect(result).toBe(validSecretData.secret);
    });

    it('should generate and save new secret if not found', async () => {
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      (readFile as jest.Mock).mockRejectedValue(enoentError);
      (mkdir as jest.Mock).mockResolvedValue(undefined);
      (writeFile as jest.Mock).mockResolvedValue(undefined);
      (rename as jest.Mock).mockResolvedValue(undefined);

      const result = await getOrCreatePersistedSecret();

      expect(result).toBe('YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE');
      expect(writeFile).toHaveBeenCalled();
    });

    it('should not save if persistence is disabled', async () => {
      process.env['NODE_ENV'] = 'production';
      const enoentError = new Error('File not found') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      (readFile as jest.Mock).mockRejectedValue(enoentError);

      const result = await getOrCreatePersistedSecret();

      expect(result).toBe('YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE');
      expect(writeFile).not.toHaveBeenCalled();
    });

    it('should handle concurrent calls with promise guard', async () => {
      // Simulate slow file read
      let resolveReadFile: (value: string) => void;
      (readFile as jest.Mock).mockReturnValue(
        new Promise<string>((resolve) => {
          resolveReadFile = resolve;
        }),
      );

      // Start two concurrent calls
      const promise1 = getOrCreatePersistedSecret();
      const promise2 = getOrCreatePersistedSecret();

      // Resolve the file read
      resolveReadFile!(JSON.stringify(validSecretData));

      // Both should return the same value
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toBe(result2);
      // Should only call readFile once due to promise guard
      expect(readFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearCachedSecret', () => {
    it('should clear the cached secret', async () => {
      // First populate cache - secrets must be at least 32 chars
      const validSecretData: RememberSecretData = {
        secret: 'cached-secret-value-abcdefghijklmnopqrs',
        createdAt: Date.now() - 1000,
        version: 1,
      };
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(validSecretData));
      await getOrCreatePersistedSecret();

      // Clear cache
      clearCachedSecret();

      // Mock new value - secrets must be at least 32 chars
      const newSecretData: RememberSecretData = {
        secret: 'new-secret-value-abcdefghijklmnopqrs',
        createdAt: Date.now() - 500,
        version: 1,
      };
      (readFile as jest.Mock).mockResolvedValue(JSON.stringify(newSecretData));

      // Should load from file again
      const result = await getOrCreatePersistedSecret();

      expect(result).toBe('new-secret-value-abcdefghijklmnopqrs');
    });
  });
});
