/**
 * Tests for CacheMemoryProvider
 */

import CacheMemoryProvider from '../providers/cache-memory.provider';

describe('CacheMemoryProvider', () => {
  let provider: CacheMemoryProvider;

  beforeEach(() => {
    jest.useFakeTimers();
    provider = new CacheMemoryProvider(60); // 60 second sweep interval
  });

  afterEach(async () => {
    await provider.close();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create provider with default sweep interval', () => {
      const p = new CacheMemoryProvider();
      expect(p).toBeDefined();
      p.close();
    });

    it('should create provider with custom sweep interval', () => {
      const p = new CacheMemoryProvider(30);
      expect(p).toBeDefined();
      p.close();
    });
  });

  describe('setValue', () => {
    it('should set a string value', async () => {
      await provider.setValue('key1', 'value1');

      const result = await provider.getValue('key1');
      expect(result).toBe('value1');
    });

    it('should set an object value (JSON stringify)', async () => {
      const obj = { foo: 'bar', num: 123 };
      await provider.setValue('key2', obj);

      const result = await provider.getValue('key2');
      expect(result).toEqual(obj);
    });

    it('should set value with TTL', async () => {
      await provider.setValue('ttl-key', 'ttl-value', 5);

      const result = await provider.getValue('ttl-key');
      expect(result).toBe('ttl-value');

      // Advance time past TTL
      jest.advanceTimersByTime(6000);

      const expired = await provider.getValue('ttl-key');
      expect(expired).toBeUndefined();
    });

    it('should clear previous timeout when updating key with TTL', async () => {
      await provider.setValue('key', 'value1', 10);
      await provider.setValue('key', 'value2', 10);

      const result = await provider.getValue('key');
      expect(result).toBe('value2');
    });

    it('should handle long TTL beyond setTimeout limit', async () => {
      // 30 days in seconds (beyond ~24.8 days limit)
      const longTtl = 30 * 24 * 60 * 60;
      await provider.setValue('long-ttl', 'value', longTtl);

      const result = await provider.getValue('long-ttl');
      expect(result).toBe('value');
    });

    it('should ignore TTL of 0', async () => {
      await provider.setValue('zero-ttl', 'value', 0);

      const result = await provider.getValue('zero-ttl');
      expect(result).toBe('value');
    });

    it('should ignore negative TTL', async () => {
      await provider.setValue('negative-ttl', 'value', -5);

      const result = await provider.getValue('negative-ttl');
      expect(result).toBe('value');
    });
  });

  describe('getValue', () => {
    it('should return undefined for non-existent key', async () => {
      const result = await provider.getValue('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return default value for non-existent key', async () => {
      const result = await provider.getValue('nonexistent', 'default');
      expect(result).toBe('default');
    });

    it('should return default value for expired key', async () => {
      await provider.setValue('expiring', 'value', 1);

      jest.advanceTimersByTime(2000);

      const result = await provider.getValue('expiring', 'expired-default');
      expect(result).toBe('expired-default');
    });

    it('should parse JSON values', async () => {
      await provider.setValue('json', { nested: { value: true } });

      const result = await provider.getValue<{ nested: { value: boolean } }>('json');
      expect(result?.nested?.value).toBe(true);
    });

    it('should return raw string if JSON parse fails', async () => {
      // Directly set a raw string that's not valid JSON
      await provider.setValue('raw', 'not-json-just-string');

      const result = await provider.getValue('raw');
      expect(result).toBe('not-json-just-string');
    });
  });

  describe('delete', () => {
    it('should delete an existing key', async () => {
      await provider.setValue('to-delete', 'value');
      expect(await provider.exists('to-delete')).toBe(true);

      await provider.delete('to-delete');
      expect(await provider.exists('to-delete')).toBe(false);
    });

    it('should clear timeout when deleting key with TTL', async () => {
      await provider.setValue('ttl-delete', 'value', 60);
      await provider.delete('ttl-delete');

      expect(await provider.exists('ttl-delete')).toBe(false);
    });

    it('should handle deleting non-existent key', async () => {
      // Should not throw
      await expect(provider.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await provider.setValue('exists-key', 'value');
      expect(await provider.exists('exists-key')).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      expect(await provider.exists('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      await provider.setValue('expires', 'value', 1);

      jest.advanceTimersByTime(2000);

      expect(await provider.exists('expires')).toBe(false);
    });

    it('should delete expired key when checking exists', async () => {
      await provider.setValue('expires', 'value', 1);

      jest.advanceTimersByTime(2000);

      await provider.exists('expires');
      // Key should be deleted after exists check
      const value = await provider.getValue('expires');
      expect(value).toBeUndefined();
    });
  });

  describe('close', () => {
    it('should clear all entries and timers', async () => {
      await provider.setValue('key1', 'value1', 60);
      await provider.setValue('key2', 'value2', 60);
      await provider.setValue('key3', 'value3');

      await provider.close();

      // After close, new provider should not see old values
      const newProvider = new CacheMemoryProvider();
      expect(await newProvider.exists('key1')).toBe(false);
      expect(await newProvider.exists('key2')).toBe(false);
      expect(await newProvider.exists('key3')).toBe(false);
      await newProvider.close();
    });
  });

  describe('sweep', () => {
    it('should clean up expired entries periodically', async () => {
      // Create provider with 1 second sweep interval
      const fastSweepProvider = new CacheMemoryProvider(1);

      await fastSweepProvider.setValue('sweep-key', 'value', 2);
      expect(await fastSweepProvider.exists('sweep-key')).toBe(true);

      // Advance time to trigger TTL expiration and sweep
      jest.advanceTimersByTime(3000);

      // Key should be removed by sweep
      expect(await fastSweepProvider.exists('sweep-key')).toBe(false);

      await fastSweepProvider.close();
    });

    it('should not remove non-expired entries during sweep', async () => {
      const fastSweepProvider = new CacheMemoryProvider(1);

      await fastSweepProvider.setValue('long-key', 'value', 60);

      // Advance time but not past TTL
      jest.advanceTimersByTime(5000);

      // Key should still exist
      expect(await fastSweepProvider.exists('long-key')).toBe(true);

      await fastSweepProvider.close();
    });

    it('should handle entries without TTL during sweep', async () => {
      const fastSweepProvider = new CacheMemoryProvider(1);

      await fastSweepProvider.setValue('no-ttl', 'permanent');

      // Advance time for sweep
      jest.advanceTimersByTime(5000);

      // Key should still exist
      expect(await fastSweepProvider.exists('no-ttl')).toBe(true);

      await fastSweepProvider.close();
    });
  });

  describe('edge cases', () => {
    it('should handle setting same key multiple times', async () => {
      await provider.setValue('key', 'value1');
      await provider.setValue('key', 'value2');
      await provider.setValue('key', 'value3');

      expect(await provider.getValue('key')).toBe('value3');
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key:with:colons/and/slashes?and&params=123';
      await provider.setValue(specialKey, 'value');

      expect(await provider.getValue(specialKey)).toBe('value');
    });

    it('should handle special values', async () => {
      await provider.setValue('null', null);
      await provider.setValue('empty-string', '');
      await provider.setValue('array', [1, 2, 3]);
      await provider.setValue('number', 123);
      await provider.setValue('boolean', true);

      expect(await provider.getValue('null')).toBeNull();
      expect(await provider.getValue('empty-string')).toBe('');
      expect(await provider.getValue('array')).toEqual([1, 2, 3]);
      expect(await provider.getValue('number')).toBe(123);
      expect(await provider.getValue('boolean')).toBe(true);
    });
  });
});
