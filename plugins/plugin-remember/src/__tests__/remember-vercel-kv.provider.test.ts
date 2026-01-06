// file: plugins/plugin-remember/src/__tests__/remember-vercel-kv.provider.test.ts

import 'reflect-metadata';
import RememberVercelKvProvider from '../providers/remember-vercel-kv.provider';

// Mock @vercel/kv
const mockKvClient = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  keys: jest.fn(),
  scan: jest.fn(),
};

const mockCreateClient = jest.fn().mockReturnValue(mockKvClient);

jest.mock('@vercel/kv', () => ({
  kv: mockKvClient,
  createClient: mockCreateClient,
}));

describe('RememberVercelKvProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with default kv instance', () => {
      const provider = new RememberVercelKvProvider();
      expect(provider).toBeDefined();
    });

    it('should create provider with custom url and token', () => {
      const provider = new RememberVercelKvProvider({
        url: 'https://custom.kv.vercel-storage.com',
        token: 'custom-token',
      });

      expect(mockCreateClient).toHaveBeenCalledWith({
        url: 'https://custom.kv.vercel-storage.com',
        token: 'custom-token',
      });
    });

    it('should throw if only url is provided', () => {
      expect(() => {
        new RememberVercelKvProvider({ url: 'https://custom.kv' });
      }).toThrow("Both 'url' and 'token' must be provided together");
    });

    it('should throw if only token is provided', () => {
      expect(() => {
        new RememberVercelKvProvider({ token: 'custom-token' });
      }).toThrow("Both 'url' and 'token' must be provided together");
    });

    it('should use default key prefix', () => {
      const provider = new RememberVercelKvProvider();
      expect(provider).toBeDefined();
    });

    it('should use custom key prefix', () => {
      const provider = new RememberVercelKvProvider({
        keyPrefix: 'myapp:',
      });
      expect(provider).toBeDefined();
    });

    it('should use custom default TTL', () => {
      const provider = new RememberVercelKvProvider({
        defaultTTL: 3600,
      });
      expect(provider).toBeDefined();
    });
  });

  describe('setValue', () => {
    let provider: RememberVercelKvProvider;

    beforeEach(() => {
      provider = new RememberVercelKvProvider();
    });

    it('should set string value without TTL', async () => {
      await provider.setValue('key', 'value');

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', 'value');
    });

    it('should set string value with TTL', async () => {
      await provider.setValue('key', 'value', 3600);

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', 'value', { ex: 3600 });
    });

    it('should serialize object values', async () => {
      await provider.setValue('key', { foo: 'bar' });

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', JSON.stringify({ foo: 'bar' }));
    });

    it('should use default TTL when not provided', async () => {
      const providerWithTTL = new RememberVercelKvProvider({ defaultTTL: 1800 });
      await providerWithTTL.setValue('key', 'value');

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', 'value', { ex: 1800 });
    });

    it('should use custom key prefix', async () => {
      const customProvider = new RememberVercelKvProvider({ keyPrefix: 'custom:' });
      await customProvider.setValue('key', 'value');

      expect(mockKvClient.set).toHaveBeenCalledWith('custom:key', 'value');
    });

    it('should not use TTL if 0', async () => {
      await provider.setValue('key', 'value', 0);

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', 'value');
    });

    it('should not use TTL if negative', async () => {
      await provider.setValue('key', 'value', -1);

      expect(mockKvClient.set).toHaveBeenCalledWith('remember:key', 'value');
    });
  });

  describe('getValue', () => {
    let provider: RememberVercelKvProvider;

    beforeEach(() => {
      provider = new RememberVercelKvProvider();
    });

    it('should return undefined when key not found (null)', async () => {
      mockKvClient.get.mockResolvedValue(null);

      const result = await provider.getValue('key');

      expect(result).toBeUndefined();
      expect(mockKvClient.get).toHaveBeenCalledWith('remember:key');
    });

    it('should return undefined when key not found (undefined)', async () => {
      mockKvClient.get.mockResolvedValue(undefined);

      const result = await provider.getValue('key');

      expect(result).toBeUndefined();
    });

    it('should return default value when key not found', async () => {
      mockKvClient.get.mockResolvedValue(null);

      const result = await provider.getValue('key', 'default');

      expect(result).toBe('default');
    });

    it('should parse JSON string value', async () => {
      mockKvClient.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));

      const result = await provider.getValue('key');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return raw string if JSON parse fails', async () => {
      mockKvClient.get.mockResolvedValue('plain-string');

      const result = await provider.getValue('key');

      expect(result).toBe('plain-string');
    });

    it('should return auto-parsed value from Vercel KV', async () => {
      // Vercel KV may auto-parse JSON, returning an object directly
      mockKvClient.get.mockResolvedValue({ foo: 'bar' });

      const result = await provider.getValue('key');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should use custom key prefix', async () => {
      const customProvider = new RememberVercelKvProvider({ keyPrefix: 'custom:' });
      mockKvClient.get.mockResolvedValue(null);

      await customProvider.getValue('key');

      expect(mockKvClient.get).toHaveBeenCalledWith('custom:key');
    });
  });

  describe('delete', () => {
    let provider: RememberVercelKvProvider;

    beforeEach(() => {
      provider = new RememberVercelKvProvider();
    });

    it('should delete key', async () => {
      await provider.delete('key');

      expect(mockKvClient.del).toHaveBeenCalledWith('remember:key');
    });

    it('should use custom key prefix', async () => {
      const customProvider = new RememberVercelKvProvider({ keyPrefix: 'custom:' });
      await customProvider.delete('key');

      expect(mockKvClient.del).toHaveBeenCalledWith('custom:key');
    });
  });

  describe('exists', () => {
    let provider: RememberVercelKvProvider;

    beforeEach(() => {
      provider = new RememberVercelKvProvider();
    });

    it('should return true when key exists', async () => {
      mockKvClient.exists.mockResolvedValue(1);

      const result = await provider.exists('key');

      expect(result).toBe(true);
      expect(mockKvClient.exists).toHaveBeenCalledWith('remember:key');
    });

    it('should return false when key does not exist', async () => {
      mockKvClient.exists.mockResolvedValue(0);

      const result = await provider.exists('key');

      expect(result).toBe(false);
    });

    it('should use custom key prefix', async () => {
      const customProvider = new RememberVercelKvProvider({ keyPrefix: 'custom:' });
      mockKvClient.exists.mockResolvedValue(1);

      await customProvider.exists('key');

      expect(mockKvClient.exists).toHaveBeenCalledWith('custom:key');
    });
  });

  describe('keys', () => {
    let provider: RememberVercelKvProvider;

    beforeEach(() => {
      provider = new RememberVercelKvProvider();
    });

    it('should return keys using scan', async () => {
      mockKvClient.scan.mockResolvedValue([0, ['remember:key1', 'remember:key2']]);

      const result = await provider.keys();

      expect(result).toEqual(['key1', 'key2']);
      expect(mockKvClient.scan).toHaveBeenCalledWith(0, {
        match: 'remember:*',
        count: 100,
      });
    });

    it('should iterate cursor until 0', async () => {
      mockKvClient.scan.mockResolvedValueOnce([123, ['remember:key1']]).mockResolvedValueOnce([0, ['remember:key2']]);

      const result = await provider.keys();

      expect(result).toEqual(['key1', 'key2']);
      expect(mockKvClient.scan).toHaveBeenCalledTimes(2);
    });

    it('should use pattern in search', async () => {
      mockKvClient.scan.mockResolvedValue([0, ['remember:user:1', 'remember:user:2']]);

      const result = await provider.keys('user:*');

      expect(result).toEqual(['user:1', 'user:2']);
      expect(mockKvClient.scan).toHaveBeenCalledWith(0, {
        match: 'remember:user:*',
        count: 100,
      });
    });

    it('should fallback to keys command if scan fails', async () => {
      mockKvClient.scan.mockRejectedValue(new Error('scan not supported'));
      mockKvClient.keys.mockResolvedValue(['remember:key1', 'remember:key2']);

      const result = await provider.keys();

      expect(result).toEqual(['key1', 'key2']);
      expect(mockKvClient.keys).toHaveBeenCalledWith('remember:*');
    });

    it('should return empty array if both scan and keys fail', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockKvClient.scan.mockRejectedValue(new Error('scan not supported'));
      mockKvClient.keys.mockRejectedValue(new Error('keys not supported'));

      const result = await provider.keys();

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('keys() operation not supported'));
      consoleSpy.mockRestore();
    });

    it('should use custom key prefix', async () => {
      const customProvider = new RememberVercelKvProvider({ keyPrefix: 'custom:' });
      mockKvClient.scan.mockResolvedValue([0, ['custom:key1']]);

      const result = await customProvider.keys();

      expect(result).toEqual(['key1']);
      expect(mockKvClient.scan).toHaveBeenCalledWith(0, {
        match: 'custom:*',
        count: 100,
      });
    });
  });

  describe('close', () => {
    it('should be a no-op', async () => {
      const provider = new RememberVercelKvProvider();
      await provider.close();
      // No assertions needed - just verifying it doesn't throw
    });
  });
});
