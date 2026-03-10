import RememberMemoryProvider from '../providers/remember-memory.provider';

describe('RememberMemoryProvider', () => {
  let provider: RememberMemoryProvider;

  beforeEach(() => {
    // Use a very long sweep interval so tests control cleanup
    provider = new RememberMemoryProvider(3600);
  });

  afterEach(async () => {
    await provider.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Basic Operations
  // ─────────────────────────────────────────────────────────────────────────

  describe('setValue / getValue', () => {
    it('stores and retrieves a string value', async () => {
      await provider.setValue('key1', 'value1');
      const result = await provider.getValue<string>('key1');

      expect(result).toBe('value1');
    });

    it('stores and retrieves an object value', async () => {
      const obj = { name: 'Alice', age: 30 };
      await provider.setValue('user', obj);
      const result = await provider.getValue<typeof obj>('user');

      expect(result).toEqual(obj);
    });

    it('stores and retrieves an array value', async () => {
      const arr = [1, 2, 3, 'four'];
      await provider.setValue('list', arr);
      const result = await provider.getValue<typeof arr>('list');

      expect(result).toEqual(arr);
    });

    it('stores and retrieves a number value', async () => {
      await provider.setValue('count', 42);
      const result = await provider.getValue<number>('count');

      expect(result).toBe(42);
    });

    it('stores and retrieves a boolean value', async () => {
      await provider.setValue('flag', true);
      const result = await provider.getValue<boolean>('flag');

      expect(result).toBe(true);
    });

    it('stores and retrieves null value', async () => {
      await provider.setValue('nothing', null);
      const result = await provider.getValue('nothing');

      expect(result).toBeNull();
    });

    it('returns undefined for non-existent key', async () => {
      const result = await provider.getValue('nonexistent');
      expect(result).toBeUndefined();
    });

    it('returns default value for non-existent key', async () => {
      const result = await provider.getValue('nonexistent', 'default');
      expect(result).toBe('default');
    });

    it('overwrites existing value', async () => {
      await provider.setValue('key', 'value1');
      await provider.setValue('key', 'value2');

      const result = await provider.getValue('key');
      expect(result).toBe('value2');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TTL Expiration
  // ─────────────────────────────────────────────────────────────────────────

  describe('TTL expiration', () => {
    it('value is available before TTL expires', async () => {
      await provider.setValue('temp', 'value', 60); // 60 seconds TTL
      const result = await provider.getValue('temp');

      expect(result).toBe('value');
    });

    it('value expires after TTL', async () => {
      // Use very short TTL for test
      await provider.setValue('temp', 'value', 0.001); // 1ms TTL

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await provider.getValue('temp');
      expect(result).toBeUndefined();
    });

    it('returns default value after TTL expires', async () => {
      await provider.setValue('temp', 'value', 0.001);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await provider.getValue('temp', 'default');
      expect(result).toBe('default');
    });

    it('setting new value clears old TTL', async () => {
      await provider.setValue('key', 'value1', 0.001);
      await provider.setValue('key', 'value2'); // No TTL

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Value should still exist (no TTL on second set)
      const result = await provider.getValue('key');
      expect(result).toBe('value2');
    });

    it('handles zero TTL as no-TTL', async () => {
      await provider.setValue('key', 'value', 0);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await provider.getValue('key');
      expect(result).toBe('value');
    });

    it('handles negative TTL as no-TTL', async () => {
      await provider.setValue('key', 'value', -1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result = await provider.getValue('key');
      expect(result).toBe('value');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Delete
  // ─────────────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes an existing key', async () => {
      await provider.setValue('key', 'value');
      await provider.delete('key');

      const result = await provider.getValue('key');
      expect(result).toBeUndefined();
    });

    it('does not throw when deleting non-existent key', async () => {
      await expect(provider.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('clears timeout when deleting key with TTL', async () => {
      await provider.setValue('key', 'value', 60);
      await provider.delete('key');

      const exists = await provider.exists('key');
      expect(exists).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Exists
  // ─────────────────────────────────────────────────────────────────────────

  describe('exists', () => {
    it('returns true for existing key', async () => {
      await provider.setValue('key', 'value');
      const exists = await provider.exists('key');

      expect(exists).toBe(true);
    });

    it('returns false for non-existent key', async () => {
      const exists = await provider.exists('nonexistent');
      expect(exists).toBe(false);
    });

    it('returns false for expired key', async () => {
      await provider.setValue('key', 'value', 0.001);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const exists = await provider.exists('key');
      expect(exists).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Keys
  // ─────────────────────────────────────────────────────────────────────────

  describe('keys', () => {
    beforeEach(async () => {
      await provider.setValue('user:1:name', 'Alice');
      await provider.setValue('user:1:email', 'alice@example.com');
      await provider.setValue('user:2:name', 'Bob');
      await provider.setValue('config:theme', 'dark');
    });

    it('returns all keys without pattern', async () => {
      const keys = await provider.keys();

      expect(keys).toHaveLength(4);
      expect(keys).toContain('user:1:name');
      expect(keys).toContain('user:1:email');
      expect(keys).toContain('user:2:name');
      expect(keys).toContain('config:theme');
    });

    it('filters keys with * wildcard pattern', async () => {
      const keys = await provider.keys('user:*');

      expect(keys).toHaveLength(3);
      expect(keys).toContain('user:1:name');
      expect(keys).toContain('user:1:email');
      expect(keys).toContain('user:2:name');
    });

    it('filters keys with exact pattern', async () => {
      const keys = await provider.keys('config:theme');

      expect(keys).toHaveLength(1);
      expect(keys).toContain('config:theme');
    });

    it('filters keys with ? wildcard pattern', async () => {
      const keys = await provider.keys('user:?:name');

      expect(keys).toHaveLength(2);
      expect(keys).toContain('user:1:name');
      expect(keys).toContain('user:2:name');
    });

    it('returns empty array for non-matching pattern', async () => {
      const keys = await provider.keys('nonexistent:*');

      expect(keys).toHaveLength(0);
    });

    it('excludes expired keys', async () => {
      await provider.setValue('temp:key', 'value', 0.001);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const keys = await provider.keys('temp:*');
      expect(keys).toHaveLength(0);
    });

    it('handles special regex characters in pattern', async () => {
      await provider.setValue('file.txt', 'content');

      // . should be literal, not regex any-char
      const keys = await provider.keys('file.txt');
      expect(keys).toContain('file.txt');

      const wrongKeys = await provider.keys('fileXtxt');
      expect(wrongKeys).not.toContain('file.txt');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Close
  // ─────────────────────────────────────────────────────────────────────────

  describe('close', () => {
    it('clears all data on close', async () => {
      await provider.setValue('key1', 'value1');
      await provider.setValue('key2', 'value2');

      await provider.close();

      // Create a new provider to check
      const newProvider = new RememberMemoryProvider(3600);
      const result = await newProvider.getValue('key1');
      expect(result).toBeUndefined();
      await newProvider.close();
    });

    it('can be closed multiple times without error', async () => {
      await provider.close();
      await expect(provider.close()).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string key', async () => {
      await provider.setValue('', 'empty key value');
      const result = await provider.getValue('');

      expect(result).toBe('empty key value');
    });

    it('handles empty string value', async () => {
      await provider.setValue('key', '');
      const result = await provider.getValue('key');

      expect(result).toBe('');
    });

    it('handles unicode keys', async () => {
      await provider.setValue('日本語', 'Japanese');
      const result = await provider.getValue('日本語');

      expect(result).toBe('Japanese');
    });

    it('handles unicode values', async () => {
      await provider.setValue('greeting', '你好世界 🌍');
      const result = await provider.getValue('greeting');

      expect(result).toBe('你好世界 🌍');
    });

    it('handles large values', async () => {
      const largeValue = 'x'.repeat(1024 * 1024); // 1MB
      await provider.setValue('large', largeValue);
      const result = await provider.getValue<string>('large');

      expect(result).toBe(largeValue);
    });

    it('handles deeply nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      };

      await provider.setValue('nested', nested);
      const result = await provider.getValue<typeof nested>('nested');

      expect(result).toEqual(nested);
    });
  });
});
