/**
 * Tests for CacheRedisProvider
 */

import CacheRedisProvider from '../providers/cache-redis.provider';
import type { RedisCacheOptions } from '../cache.types';

// Mock ioredis
jest.mock('ioredis', () => {
  const mockClient = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };

  return jest.fn().mockImplementation(() => mockClient);
});

describe('CacheRedisProvider', () => {
  let provider: CacheRedisProvider;
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    const Redis = require('ioredis');
    provider = new CacheRedisProvider({
      type: 'redis',
      config: { host: 'localhost', port: 6379 },
    });
    mockClient = Redis.mock.results[0].value;
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with redis config', () => {
      const Redis = require('ioredis');
      jest.clearAllMocks();

      new CacheRedisProvider({
        type: 'redis',
        config: { host: 'localhost', port: 6379 },
      });

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        }),
      );
    });

    it('should accept existing redis client', () => {
      const existingClient = {
        set: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        exists: jest.fn(),
        quit: jest.fn(),
      };

      const p = new CacheRedisProvider({
        type: 'redis-client',
        client: existingClient as any,
      });

      expect(p).toBeDefined();
    });

    it('should throw for invalid type', () => {
      expect(() => {
        new CacheRedisProvider({
          type: 'invalid' as any,
        } as RedisCacheOptions);
      }).toThrow('Invalid cache provider type');
    });

    it('should set up event listeners', () => {
      expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should log on connect event', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      // Get the connect callback
      const connectCall = mockClient.on.mock.calls.find((call: any[]) => call[0] === 'connect');
      connectCall[1](); // Invoke the callback

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Connected');
      consoleSpy.mockRestore();
    });

    it('should log on error event', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Get the error callback
      const errorCall = mockClient.on.mock.calls.find((call: any[]) => call[0] === 'error');
      const testError = new Error('Test error');
      errorCall[1](testError); // Invoke the callback

      expect(consoleSpy).toHaveBeenCalledWith('[Redis] Error:', testError);
      consoleSpy.mockRestore();
    });
  });

  describe('setValue', () => {
    it('should set string value without TTL', async () => {
      mockClient.set.mockResolvedValue('OK');

      await provider.setValue('key', 'value');

      expect(mockClient.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should set object value (JSON stringify)', async () => {
      mockClient.set.mockResolvedValue('OK');
      const obj = { foo: 'bar' };

      await provider.setValue('key', obj);

      expect(mockClient.set).toHaveBeenCalledWith('key', JSON.stringify(obj));
    });

    it('should set value with TTL', async () => {
      mockClient.set.mockResolvedValue('OK');

      await provider.setValue('key', 'value', 60);

      expect(mockClient.set).toHaveBeenCalledWith('key', 'value', 'EX', 60);
    });

    it('should not set TTL for zero seconds', async () => {
      mockClient.set.mockResolvedValue('OK');

      await provider.setValue('key', 'value', 0);

      expect(mockClient.set).toHaveBeenCalledWith('key', 'value');
    });

    it('should not set TTL for negative seconds', async () => {
      mockClient.set.mockResolvedValue('OK');

      await provider.setValue('key', 'value', -5);

      expect(mockClient.set).toHaveBeenCalledWith('key', 'value');
    });
  });

  describe('getValue', () => {
    it('should return parsed JSON value', async () => {
      const obj = { foo: 'bar' };
      mockClient.get.mockResolvedValue(JSON.stringify(obj));

      const result = await provider.getValue('key');

      expect(result).toEqual(obj);
    });

    it('should return raw string if not valid JSON', async () => {
      mockClient.get.mockResolvedValue('plain-string');

      const result = await provider.getValue('key');

      expect(result).toBe('plain-string');
    });

    it('should return undefined for non-existent key', async () => {
      mockClient.get.mockResolvedValue(null);

      const result = await provider.getValue('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should return default value for non-existent key', async () => {
      mockClient.get.mockResolvedValue(null);

      const result = await provider.getValue('nonexistent', 'default');

      expect(result).toBe('default');
    });
  });

  describe('delete', () => {
    it('should delete a key', async () => {
      mockClient.del.mockResolvedValue(1);

      await provider.delete('key');

      expect(mockClient.del).toHaveBeenCalledWith('key');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockClient.exists.mockResolvedValue(1);

      const result = await provider.exists('key');

      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockClient.exists.mockResolvedValue(0);

      const result = await provider.exists('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should quit the Redis connection', async () => {
      mockClient.quit.mockResolvedValue('OK');

      await provider.close();

      expect(mockClient.quit).toHaveBeenCalled();
    });
  });
});
