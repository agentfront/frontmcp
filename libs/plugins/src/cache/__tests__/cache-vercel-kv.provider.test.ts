// Mock @vercel/kv before importing the provider
const mockKvSet = jest.fn();
const mockKvGet = jest.fn();
const mockKvDel = jest.fn();
const mockKvExists = jest.fn();
const mockCreateClient = jest.fn();

jest.mock('@vercel/kv', () => ({
  kv: {
    set: mockKvSet,
    get: mockKvGet,
    del: mockKvDel,
    exists: mockKvExists,
  },
  createClient: mockCreateClient.mockReturnValue({
    set: mockKvSet,
    get: mockKvGet,
    del: mockKvDel,
    exists: mockKvExists,
  }),
}));

import CacheVercelKvProvider from '../providers/cache-vercel-kv.provider';

describe('CacheVercelKvProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default kv instance when no url/token provided', () => {
      new CacheVercelKvProvider();
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('should create custom client when url and token provided', () => {
      new CacheVercelKvProvider({
        url: 'https://custom-kv.vercel.com',
        token: 'custom-token',
      });

      expect(mockCreateClient).toHaveBeenCalledWith({
        url: 'https://custom-kv.vercel.com',
        token: 'custom-token',
      });
    });

    it('should use default keyPrefix of "cache:"', () => {
      const provider = new CacheVercelKvProvider();
      // We can verify this indirectly through the setValue call
      provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith('cache:testkey', expect.any(String), expect.any(Object));
    });

    it('should use custom keyPrefix when provided', () => {
      const provider = new CacheVercelKvProvider({ keyPrefix: 'myapp:' });
      provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith('myapp:testkey', expect.any(String), expect.any(Object));
    });

    it('should use default TTL of 1 day', () => {
      const provider = new CacheVercelKvProvider();
      provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith(expect.any(String), expect.any(String), { ex: 60 * 60 * 24 });
    });

    it('should use custom defaultTTL when provided', () => {
      const provider = new CacheVercelKvProvider({ defaultTTL: 3600 });
      provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith(expect.any(String), expect.any(String), { ex: 3600 });
    });
  });

  describe('setValue', () => {
    it('should stringify object values', async () => {
      const provider = new CacheVercelKvProvider();
      const value = { foo: 'bar', count: 42 };

      await provider.setValue('objkey', value);

      expect(mockKvSet).toHaveBeenCalledWith('cache:objkey', JSON.stringify(value), { ex: 60 * 60 * 24 });
    });

    it('should store string values directly', async () => {
      const provider = new CacheVercelKvProvider();

      await provider.setValue('strkey', 'plain string');

      expect(mockKvSet).toHaveBeenCalledWith('cache:strkey', 'plain string', { ex: 60 * 60 * 24 });
    });

    it('should use custom TTL when provided', async () => {
      const provider = new CacheVercelKvProvider();

      await provider.setValue('key', 'value', 1800);

      expect(mockKvSet).toHaveBeenCalledWith('cache:key', 'value', { ex: 1800 });
    });

    it('should store without TTL when explicit TTL is 0', async () => {
      const provider = new CacheVercelKvProvider({ defaultTTL: 7200 });

      await provider.setValue('key', 'value', 0);

      // TTL of 0 means no expiration
      expect(mockKvSet).toHaveBeenCalledWith('cache:key', 'value');
    });

    it('should store without TTL when defaultTTL is 0', async () => {
      const provider = new CacheVercelKvProvider({ defaultTTL: 0 });

      await provider.setValue('key', 'value');

      expect(mockKvSet).toHaveBeenCalledWith('cache:key', 'value');
    });

    it('should store without TTL when TTL is negative', async () => {
      const provider = new CacheVercelKvProvider({ defaultTTL: -1 });

      await provider.setValue('key', 'value');

      // When defaultTTL is negative, it should not set { ex: ... }
      expect(mockKvSet).toHaveBeenCalledWith('cache:key', 'value');
    });

    it('should stringify arrays', async () => {
      const provider = new CacheVercelKvProvider();
      const value = [1, 2, 3, 'four'];

      await provider.setValue('arrkey', value);

      expect(mockKvSet).toHaveBeenCalledWith('cache:arrkey', JSON.stringify(value), { ex: 60 * 60 * 24 });
    });

    it('should stringify nested objects', async () => {
      const provider = new CacheVercelKvProvider();
      const value = { nested: { deep: { value: 'test' } } };

      await provider.setValue('nestedkey', value);

      expect(mockKvSet).toHaveBeenCalledWith('cache:nestedkey', JSON.stringify(value), { ex: 60 * 60 * 24 });
    });
  });

  describe('getValue', () => {
    it('should return undefined for missing keys', async () => {
      mockKvGet.mockResolvedValue(null);
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('missing');

      expect(result).toBeUndefined();
      expect(mockKvGet).toHaveBeenCalledWith('cache:missing');
    });

    it('should return default value for missing keys', async () => {
      mockKvGet.mockResolvedValue(null);
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('missing', 'default');

      expect(result).toBe('default');
    });

    it('should parse JSON string values', async () => {
      mockKvGet.mockResolvedValue('{"foo":"bar"}');
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('jsonkey');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return plain strings that are not JSON', async () => {
      mockKvGet.mockResolvedValue('plain string');
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('strkey');

      expect(result).toBe('plain string');
    });

    it('should handle already parsed objects from Vercel KV', async () => {
      // Vercel KV auto-parses JSON in some cases
      mockKvGet.mockResolvedValue({ already: 'parsed' });
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('objkey');

      expect(result).toEqual({ already: 'parsed' });
    });

    it('should return undefined for undefined values', async () => {
      mockKvGet.mockResolvedValue(undefined);
      const provider = new CacheVercelKvProvider();

      const result = await provider.getValue('undefinedkey');

      expect(result).toBeUndefined();
    });

    it('should use correct prefixed key', async () => {
      mockKvGet.mockResolvedValue('value');
      const provider = new CacheVercelKvProvider({ keyPrefix: 'custom:' });

      await provider.getValue('mykey');

      expect(mockKvGet).toHaveBeenCalledWith('custom:mykey');
    });
  });

  describe('delete', () => {
    it('should delete key with correct prefix', async () => {
      const provider = new CacheVercelKvProvider();

      await provider.delete('testkey');

      expect(mockKvDel).toHaveBeenCalledWith('cache:testkey');
    });

    it('should use custom prefix', async () => {
      const provider = new CacheVercelKvProvider({ keyPrefix: 'myprefix:' });

      await provider.delete('testkey');

      expect(mockKvDel).toHaveBeenCalledWith('myprefix:testkey');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockKvExists.mockResolvedValue(1);
      const provider = new CacheVercelKvProvider();

      const result = await provider.exists('existingkey');

      expect(result).toBe(true);
      expect(mockKvExists).toHaveBeenCalledWith('cache:existingkey');
    });

    it('should return false when key does not exist', async () => {
      mockKvExists.mockResolvedValue(0);
      const provider = new CacheVercelKvProvider();

      const result = await provider.exists('missingkey');

      expect(result).toBe(false);
    });

    it('should use custom prefix', async () => {
      mockKvExists.mockResolvedValue(1);
      const provider = new CacheVercelKvProvider({ keyPrefix: 'app:' });

      await provider.exists('testkey');

      expect(mockKvExists).toHaveBeenCalledWith('app:testkey');
    });
  });

  describe('close', () => {
    it('should complete without error (no-op for Vercel KV)', async () => {
      const provider = new CacheVercelKvProvider();

      await expect(provider.close()).resolves.toBeUndefined();
    });
  });

  describe('CacheStoreInterface compliance', () => {
    it('should implement all required methods', () => {
      const provider = new CacheVercelKvProvider();

      expect(typeof provider.setValue).toBe('function');
      expect(typeof provider.getValue).toBe('function');
      expect(typeof provider.delete).toBe('function');
      expect(typeof provider.exists).toBe('function');
      expect(typeof provider.close).toBe('function');
    });
  });
});
