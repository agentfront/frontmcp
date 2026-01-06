// file: plugins/plugin-remember/src/__tests__/remember-redis.provider.test.ts

import 'reflect-metadata';
import RememberRedisProvider from '../providers/remember-redis.provider';

// Mock ioredis
const mockRedis = {
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  quit: jest.fn(),
  keys: jest.fn(),
  scan: jest.fn(),
  mget: jest.fn(),
  ttl: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

describe('RememberRedisProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with redis config', () => {
      const provider = new RememberRedisProvider({
        type: 'redis',
        config: {
          host: 'localhost',
          port: 6379,
        },
      });
      expect(provider).toBeDefined();
    });

    it('should create provider with redis client', () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });
      expect(provider).toBeDefined();
    });

    it('should use key prefix', () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
        keyPrefix: 'test:',
      });
      expect(provider).toBeDefined();
    });
  });

  describe('setValue', () => {
    it('should set value with TTL', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await provider.setValue('key', 'value', 3600);

      expect(mockRedis.set).toHaveBeenCalledWith('key', 'value', 'EX', 3600);
    });

    it('should set value without TTL', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await provider.setValue('key', 'value');

      expect(mockRedis.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should serialize objects', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await provider.setValue('key', { foo: 'bar' });

      expect(mockRedis.set).toHaveBeenCalledWith('key', JSON.stringify({ foo: 'bar' }));
    });

    it('should throw on undefined value', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await expect(provider.setValue('key', undefined)).rejects.toThrow('Cannot store undefined');
    });

    it('should throw on invalid TTL type', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await expect(provider.setValue('key', 'value', NaN)).rejects.toThrow('Invalid TTL');
    });

    it('should throw on zero TTL', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await expect(provider.setValue('key', 'value', 0)).rejects.toThrow('must be positive');
    });

    it('should throw on negative TTL', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await expect(provider.setValue('key', 'value', -1)).rejects.toThrow('must be positive');
    });

    it('should throw on non-integer TTL', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await expect(provider.setValue('key', 'value', 3.5)).rejects.toThrow('must be an integer');
    });

    it('should use key prefix', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
        keyPrefix: 'prefix:',
      });

      await provider.setValue('key', 'value');

      expect(mockRedis.set).toHaveBeenCalledWith('prefix:key', 'value');
    });
  });

  describe('getValue', () => {
    it('should return default when key not found', async () => {
      mockRedis.get.mockResolvedValue(null);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.getValue('key', 'default');

      expect(result).toBe('default');
    });

    it('should return undefined when key not found and no default', async () => {
      mockRedis.get.mockResolvedValue(null);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.getValue('key');

      expect(result).toBeUndefined();
    });

    it('should parse and return value', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.getValue('key');

      expect(result).toEqual({ foo: 'bar' });
    });

    it('should return default on parse error', async () => {
      mockRedis.get.mockResolvedValue('invalid json');
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.getValue('key', 'default');

      expect(result).toBe('default');
    });

    it('should use key prefix', async () => {
      mockRedis.get.mockResolvedValue(null);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
        keyPrefix: 'prefix:',
      });

      await provider.getValue('key');

      expect(mockRedis.get).toHaveBeenCalledWith('prefix:key');
    });
  });

  describe('delete', () => {
    it('should delete key', async () => {
      mockRedis.del.mockResolvedValue(1);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await provider.delete('key');

      expect(mockRedis.del).toHaveBeenCalledWith('key');
    });

    it('should use key prefix', async () => {
      mockRedis.del.mockResolvedValue(1);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
        keyPrefix: 'prefix:',
      });

      await provider.delete('key');

      expect(mockRedis.del).toHaveBeenCalledWith('prefix:key');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockRedis.exists.mockResolvedValue(1);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.exists('key');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedis.exists.mockResolvedValue(0);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.exists('key');

      expect(result).toBe(false);
    });
  });

  describe('keys', () => {
    it('should return keys matching pattern using scan', async () => {
      mockRedis.scan.mockResolvedValue(['0', ['prefix:key1', 'prefix:key2']]);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
        keyPrefix: 'prefix:',
      });

      const result = await provider.keys('*');

      expect(result).toEqual(['key1', 'key2']);
    });

    it('should return empty array when no keys found', async () => {
      mockRedis.scan.mockResolvedValue(['0', []]);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.keys('*');

      expect(result).toEqual([]);
    });

    it('should iterate using cursor', async () => {
      mockRedis.scan.mockResolvedValueOnce(['1', ['key1']]).mockResolvedValueOnce(['0', ['key2']]);
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      const result = await provider.keys('*');

      expect(result).toEqual(['key1', 'key2']);
      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
    });
  });

  describe('close', () => {
    it('should close owned client', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis',
        config: { host: 'localhost', port: 6379 },
      });

      await provider.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });

    it('should not close externally provided client', async () => {
      const provider = new RememberRedisProvider({
        type: 'redis-client',
        client: mockRedis as any,
      });

      await provider.close();

      expect(mockRedis.quit).not.toHaveBeenCalled();
    });
  });
});
