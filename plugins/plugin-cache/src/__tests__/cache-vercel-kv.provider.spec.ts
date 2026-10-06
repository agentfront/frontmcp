import CacheVercelKvProvider from '../providers/cache-vercel-kv.provider';

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

describe('CacheVercelKvProvider', () => {
  const savedEnv = { url: process.env['KV_REST_API_URL'], token: process.env['KV_REST_API_TOKEN'] };

  beforeAll(() => {
    process.env['KV_REST_API_URL'] = 'https://env-kv.vercel.com';
    process.env['KV_REST_API_TOKEN'] = 'env-token';
  });

  afterAll(() => {
    process.env['KV_REST_API_URL'] = savedEnv.url;
    process.env['KV_REST_API_TOKEN'] = savedEnv.token;
    if (savedEnv.url === undefined) delete process.env['KV_REST_API_URL'];
    if (savedEnv.token === undefined) delete process.env['KV_REST_API_TOKEN'];
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('connects to KV_REST_API_URL and KV_REST_API_TOKEN when no url/token is provided', async () => {
      await new CacheVercelKvProvider().setValue('key', 'value');

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://env-kv.vercel.com', token: 'env-token' }),
      );
    });

    it('builds its own client from the url and token provided', async () => {
      await new CacheVercelKvProvider({ url: 'https://custom-kv.vercel.com', token: 'custom-token' }).setValue(
        'key',
        'value',
      );

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://custom-kv.vercel.com', token: 'custom-token' }),
      );
    });

    it('leaves the fetch cache mode unset, which Cloudflare Workers require (#711)', async () => {
      await new CacheVercelKvProvider().setValue('key', 'value');

      const [config] = mockCreateClient.mock.calls[0] as unknown as [Record<string, unknown>];
      expect(config).toHaveProperty('cache', undefined);
      expect(config).toHaveProperty('automaticDeserialization', false);
    });

    it('builds the client once', async () => {
      const provider = new CacheVercelKvProvider();

      await provider.setValue('a', 'value');
      await provider.getValue('a');

      expect(mockCreateClient).toHaveBeenCalledTimes(1);
    });

    it('builds the client again after a failed attempt', async () => {
      mockCreateClient.mockImplementationOnce(() => {
        throw new Error('kv unavailable');
      });
      const provider = new CacheVercelKvProvider();

      await expect(provider.setValue('key', 'value')).rejects.toThrow('kv unavailable');
      await provider.setValue('key', 'value');

      expect(mockCreateClient).toHaveBeenCalledTimes(2);
      expect(mockKvSet).toHaveBeenCalledTimes(1);
    });

    it('should throw error when only url is provided without token', () => {
      expect(() => {
        new CacheVercelKvProvider({ url: 'https://kv.example.com' });
      }).toThrow("Both 'url' and 'token' must be provided together");
    });

    it('should throw error when only token is provided without url', () => {
      expect(() => {
        new CacheVercelKvProvider({ token: 'secret-token' });
      }).toThrow("Both 'url' and 'token' must be provided together");
    });

    it('should use default keyPrefix of "cache:"', async () => {
      const provider = new CacheVercelKvProvider();
      // We can verify this indirectly through the setValue call
      await provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith('cache:testkey', expect.any(String), expect.any(Object));
    });

    it('should use custom keyPrefix when provided', async () => {
      const provider = new CacheVercelKvProvider({ keyPrefix: 'myapp:' });
      await provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith('myapp:testkey', expect.any(String), expect.any(Object));
    });

    it('should use default TTL of 1 day', async () => {
      const provider = new CacheVercelKvProvider();
      await provider.setValue('testkey', 'value');
      expect(mockKvSet).toHaveBeenCalledWith(expect.any(String), expect.any(String), { ex: 60 * 60 * 24 });
    });

    it('should use custom defaultTTL when provided', async () => {
      const provider = new CacheVercelKvProvider({ defaultTTL: 3600 });
      await provider.setValue('testkey', 'value');
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

    it('should return a non-string value as it is', async () => {
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
