/**
 * Redis Storage Adapter Tests
 *
 * Comprehensive tests for RedisStorageAdapter with mocked ioredis.
 */

import { RedisStorageAdapter } from '../redis';
import { StorageConfigError, StorageConnectionError } from '../../errors';

// Mock Redis client
const createMockRedisClient = () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  mget: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  incrby: jest.fn(),
  scan: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  pipeline: jest.fn(),
  duplicate: jest.fn(),
  on: jest.fn(),
});

// Mock ioredis module
const mockRedisInstance = createMockRedisClient();
const MockRedisClass = jest.fn(() => mockRedisInstance);

jest.mock('ioredis', () => ({
  default: MockRedisClass,
  __esModule: true,
}));

describe('RedisStorageAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock instance
    Object.assign(mockRedisInstance, createMockRedisClient());

    // Clear environment variables
    delete process.env['REDIS_URL'];
    delete process.env['REDIS_HOST'];

    // Default mock implementations
    mockRedisInstance.ping.mockResolvedValue('PONG');
    mockRedisInstance.quit.mockResolvedValue('OK');
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockRedisInstance.del.mockResolvedValue(1);
    mockRedisInstance.exists.mockResolvedValue(1);
    mockRedisInstance.expire.mockResolvedValue(1);
    mockRedisInstance.ttl.mockResolvedValue(60);
    mockRedisInstance.incr.mockResolvedValue(1);
    mockRedisInstance.decr.mockResolvedValue(0);
    mockRedisInstance.incrby.mockResolvedValue(5);
    mockRedisInstance.publish.mockResolvedValue(1);
    mockRedisInstance.subscribe.mockResolvedValue(1);
    mockRedisInstance.unsubscribe.mockResolvedValue(1);
    mockRedisInstance.mget.mockResolvedValue([]);
    mockRedisInstance.scan.mockResolvedValue(['0', []]);

    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

    // Mock duplicate for subscriber
    mockRedisInstance.duplicate.mockReturnValue({
      ...createMockRedisClient(),
      on: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Constructor', () => {
    it('should throw StorageConfigError when both client and config provided', () => {
      const externalClient = createMockRedisClient();

      expect(
        () =>
          new RedisStorageAdapter({
            client: externalClient as unknown as import('ioredis').Redis,
            url: 'redis://localhost:6379',
          }),
      ).toThrow(StorageConfigError);

      expect(
        () =>
          new RedisStorageAdapter({
            client: externalClient as unknown as import('ioredis').Redis,
            config: { host: 'localhost' },
          }),
      ).toThrow(StorageConfigError);
    });

    it('should throw StorageConfigError when neither client nor config provided', () => {
      expect(() => new RedisStorageAdapter()).toThrow(StorageConfigError);
      expect(() => new RedisStorageAdapter({})).toThrow(StorageConfigError);
    });

    it('should read REDIS_URL from environment', () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      const adapter = new RedisStorageAdapter();
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });

    it('should read REDIS_HOST from environment', () => {
      process.env['REDIS_HOST'] = 'localhost';

      const adapter = new RedisStorageAdapter();
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });

    it('should apply custom keyPrefix', () => {
      process.env['REDIS_URL'] = 'redis://localhost:6379';

      const adapter = new RedisStorageAdapter({ keyPrefix: 'myapp:' });
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });

    it('should accept external client', () => {
      const externalClient = createMockRedisClient();

      const adapter = new RedisStorageAdapter({
        client: externalClient as unknown as import('ioredis').Redis,
      });
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });

    it('should accept url configuration', () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });

    it('should accept config object', () => {
      const adapter = new RedisStorageAdapter({
        config: { host: 'localhost', port: 6379, password: 'secret', db: 1, tls: true },
      });
      expect(adapter).toBeInstanceOf(RedisStorageAdapter);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should connect with URL configuration', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
      expect(mockRedisInstance.ping).toHaveBeenCalled();
    });

    it('should connect with host configuration', async () => {
      const adapter = new RedisStorageAdapter({
        config: { host: 'localhost', port: 6380 },
      });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
    });

    it('should connect with external client', async () => {
      const externalClient = {
        ...createMockRedisClient(),
        ping: jest.fn().mockResolvedValue('PONG'),
      };

      const adapter = new RedisStorageAdapter({
        client: externalClient as unknown as import('ioredis').Redis,
      });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
      expect(externalClient.ping).toHaveBeenCalled();
    });

    it('should not reconnect if already connected', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();
      await adapter.connect(); // Second call should be no-op

      expect(MockRedisClass).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageConnectionError on connection failure', async () => {
      mockRedisInstance.ping.mockRejectedValue(new Error('Connection refused'));

      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
    });

    it('should disconnect and cleanup', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();
      await adapter.disconnect();

      expect(await adapter.ping()).toBe(false);
      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it('should not quit external client on disconnect', async () => {
      const externalClient = {
        ...createMockRedisClient(),
        ping: jest.fn().mockResolvedValue('PONG'),
        quit: jest.fn().mockResolvedValue('OK'),
      };

      const adapter = new RedisStorageAdapter({
        client: externalClient as unknown as import('ioredis').Redis,
      });

      await adapter.connect();
      await adapter.disconnect();

      // Should NOT quit external client
      expect(externalClient.quit).not.toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      // Should not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('should return true from ping when connected', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
    });

    it('should return false from ping when not connected', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      expect(await adapter.ping()).toBe(false);
    });

    it('should return false from ping on error', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();
      mockRedisInstance.ping.mockRejectedValue(new Error('Connection lost'));

      expect(await adapter.ping()).toBe(false);
    });
  });

  describe('Core Operations', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('get()', () => {
      it('should get value with prefix', async () => {
        mockRedisInstance.get.mockResolvedValue('value');

        const result = await adapter.get('key');

        expect(mockRedisInstance.get).toHaveBeenCalledWith('test:key');
        expect(result).toBe('value');
      });

      it('should return null for non-existing key', async () => {
        mockRedisInstance.get.mockResolvedValue(null);

        const result = await adapter.get('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('set()', () => {
      it('should set value with prefix', async () => {
        await adapter.set('key', 'value');

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value');
      });

      it('should set value with TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300 });

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value', 'EX', 300);
      });

      it('should set value with NX option', async () => {
        await adapter.set('key', 'value', { ifNotExists: true });

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value', 'NX');
      });

      it('should set value with XX option', async () => {
        await adapter.set('key', 'value', { ifExists: true });

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value', 'XX');
      });

      it('should set value with TTL and NX', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300, ifNotExists: true });

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value', 'EX', 300, 'NX');
      });

      it('should set value with TTL and XX', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300, ifExists: true });

        expect(mockRedisInstance.set).toHaveBeenCalledWith('test:key', 'value', 'EX', 300, 'XX');
      });
    });

    describe('delete()', () => {
      it('should delete key with prefix', async () => {
        mockRedisInstance.del.mockResolvedValue(1);

        const result = await adapter.delete('key');

        expect(mockRedisInstance.del).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockRedisInstance.del.mockResolvedValue(0);

        const result = await adapter.delete('nonexistent');

        expect(result).toBe(false);
      });
    });

    describe('exists()', () => {
      it('should check existence with prefix', async () => {
        mockRedisInstance.exists.mockResolvedValue(1);

        const result = await adapter.exists('key');

        expect(mockRedisInstance.exists).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockRedisInstance.exists.mockResolvedValue(0);

        const result = await adapter.exists('nonexistent');

        expect(result).toBe(false);
      });
    });
  });

  describe('Batch Operations', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('mget()', () => {
      it('should get multiple values with prefix', async () => {
        mockRedisInstance.mget.mockResolvedValue(['value1', 'value2', null]);

        const result = await adapter.mget(['key1', 'key2', 'key3']);

        expect(mockRedisInstance.mget).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
        expect(result).toEqual(['value1', 'value2', null]);
      });

      it('should return empty array for empty input', async () => {
        const result = await adapter.mget([]);

        expect(result).toEqual([]);
        expect(mockRedisInstance.mget).not.toHaveBeenCalled();
      });
    });

    describe('mset()', () => {
      it('should set multiple values using pipeline', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([
          { key: 'key1', value: 'value1' },
          { key: 'key2', value: 'value2' },
        ]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1');
        expect(mockPipeline.set).toHaveBeenCalledWith('test:key2', 'value2');
        expect(mockPipeline.exec).toHaveBeenCalled();
      });

      it('should handle mset with TTL options', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([{ key: 'key1', value: 'value1', options: { ttlSeconds: 300 } }]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1', 'EX', 300);
      });

      it('should handle mset with NX option', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([{ key: 'key1', value: 'value1', options: { ifNotExists: true } }]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1', 'NX');
      });

      it('should handle mset with XX option', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([{ key: 'key1', value: 'value1', options: { ifExists: true } }]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1', 'XX');
      });

      it('should handle mset with TTL and NX', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([{ key: 'key1', value: 'value1', options: { ttlSeconds: 60, ifNotExists: true } }]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1', 'EX', 60, 'NX');
      });

      it('should handle mset with TTL and XX', async () => {
        const mockPipeline = {
          set: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };
        mockRedisInstance.pipeline.mockReturnValue(mockPipeline);

        await adapter.mset([{ key: 'key1', value: 'value1', options: { ttlSeconds: 60, ifExists: true } }]);

        expect(mockPipeline.set).toHaveBeenCalledWith('test:key1', 'value1', 'EX', 60, 'XX');
      });

      it('should return early for empty input', async () => {
        await adapter.mset([]);

        expect(mockRedisInstance.pipeline).not.toHaveBeenCalled();
      });
    });

    describe('mdelete()', () => {
      it('should delete multiple keys with prefix', async () => {
        mockRedisInstance.del.mockResolvedValue(2);

        const result = await adapter.mdelete(['key1', 'key2']);

        expect(mockRedisInstance.del).toHaveBeenCalledWith('test:key1', 'test:key2');
        expect(result).toBe(2);
      });

      it('should return 0 for empty input', async () => {
        const result = await adapter.mdelete([]);

        expect(result).toBe(0);
        expect(mockRedisInstance.del).not.toHaveBeenCalled();
      });
    });
  });

  describe('TTL Operations', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('expire()', () => {
      it('should set TTL on key', async () => {
        mockRedisInstance.expire.mockResolvedValue(1);

        const result = await adapter.expire('key', 300);

        expect(mockRedisInstance.expire).toHaveBeenCalledWith('test:key', 300);
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockRedisInstance.expire.mockResolvedValue(0);

        const result = await adapter.expire('nonexistent', 300);

        expect(result).toBe(false);
      });
    });

    describe('ttl()', () => {
      it('should return TTL for key with expiry', async () => {
        mockRedisInstance.ttl.mockResolvedValue(250);

        const result = await adapter.ttl('key');

        expect(mockRedisInstance.ttl).toHaveBeenCalledWith('test:key');
        expect(result).toBe(250);
      });

      it('should return null when key does not exist', async () => {
        mockRedisInstance.ttl.mockResolvedValue(-2);

        const result = await adapter.ttl('nonexistent');

        expect(result).toBeNull();
      });

      it('should return -1 when key has no TTL', async () => {
        mockRedisInstance.ttl.mockResolvedValue(-1);

        const result = await adapter.ttl('key');

        expect(result).toBe(-1);
      });
    });
  });

  describe('Key Enumeration', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('keys()', () => {
      it('should scan keys with SCAN and remove prefix', async () => {
        mockRedisInstance.scan
          .mockResolvedValueOnce(['10', ['test:key1', 'test:key2']])
          .mockResolvedValueOnce(['0', ['test:key3']]);

        const result = await adapter.keys('*');

        expect(mockRedisInstance.scan).toHaveBeenCalledWith('0', 'MATCH', 'test:*', 'COUNT', 100);
        expect(result).toEqual(['key1', 'key2', 'key3']);
      });

      it('should use pattern with prefix', async () => {
        mockRedisInstance.scan.mockResolvedValue(['0', ['test:user:1', 'test:user:2']]);

        const result = await adapter.keys('user:*');

        expect(mockRedisInstance.scan).toHaveBeenCalledWith('0', 'MATCH', 'test:user:*', 'COUNT', 100);
        expect(result).toEqual(['user:1', 'user:2']);
      });

      it('should return empty array when no keys match', async () => {
        mockRedisInstance.scan.mockResolvedValue(['0', []]);

        const result = await adapter.keys('nonexistent:*');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Atomic Operations', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('incr()', () => {
      it('should increment key with prefix', async () => {
        mockRedisInstance.incr.mockResolvedValue(5);

        const result = await adapter.incr('counter');

        expect(mockRedisInstance.incr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(5);
      });
    });

    describe('decr()', () => {
      it('should decrement key with prefix', async () => {
        mockRedisInstance.decr.mockResolvedValue(3);

        const result = await adapter.decr('counter');

        expect(mockRedisInstance.decr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(3);
      });
    });

    describe('incrBy()', () => {
      it('should increment key by amount with prefix', async () => {
        mockRedisInstance.incrby.mockResolvedValue(10);

        const result = await adapter.incrBy('counter', 5);

        expect(mockRedisInstance.incrby).toHaveBeenCalledWith('test:counter', 5);
        expect(result).toBe(10);
      });
    });
  });

  describe('Pub/Sub', () => {
    let adapter: RedisStorageAdapter;

    beforeEach(async () => {
      adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('supportsPubSub()', () => {
      it('should return true', () => {
        expect(adapter.supportsPubSub()).toBe(true);
      });
    });

    describe('publish()', () => {
      it('should publish message with prefix', async () => {
        mockRedisInstance.publish.mockResolvedValue(1);

        const result = await adapter.publish('channel', 'message');

        expect(mockRedisInstance.publish).toHaveBeenCalledWith('test:channel', 'message');
        expect(result).toBe(1);
      });
    });

    describe('subscribe()', () => {
      it('should return unsubscribe function', async () => {
        const handler = jest.fn();
        const unsubscribe = await adapter.subscribe('channel', handler);

        expect(typeof unsubscribe).toBe('function');

        // Clean up
        await unsubscribe();
      });
    });
  });

  describe('getClient()', () => {
    it('should return undefined when not connected', () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      expect(adapter.getClient()).toBeUndefined();
    });

    it('should return client when connected', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();

      expect(adapter.getClient()).toBeDefined();

      await adapter.disconnect();
    });
  });

  describe('Error Handling', () => {
    it('should throw when operations called before connect', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await expect(adapter.get('key')).rejects.toThrow('is not connected');
    });

    it('should throw StorageConnectionError when client is undefined after connect', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

      await adapter.connect();
      await adapter.disconnect();

      await expect(adapter.get('key')).rejects.toThrow('is not connected');
    });
  });

  describe('Key Prefix Handling', () => {
    it('should work without prefix', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });
      await adapter.connect();

      mockRedisInstance.get.mockResolvedValue('value');

      await adapter.get('key');

      expect(mockRedisInstance.get).toHaveBeenCalledWith('key');

      await adapter.disconnect();
    });

    it('should correctly unprefix keys', async () => {
      const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'prefix:' });
      await adapter.connect();

      mockRedisInstance.scan.mockResolvedValue(['0', ['prefix:key1', 'prefix:key2', 'other:key3']]);

      const result = await adapter.keys('*');

      expect(result).toContain('key1');
      expect(result).toContain('key2');
      expect(result).toContain('other:key3'); // No prefix to remove

      await adapter.disconnect();
    });
  });

  describe('Additional Coverage Tests', () => {
    describe('Config-based connection (no URL)', () => {
      it('should connect using config object with all options', async () => {
        // Reset mocks to ensure clean state
        jest.clearAllMocks();
        mockRedisInstance.ping.mockResolvedValue('PONG');

        const adapter = new RedisStorageAdapter({
          config: {
            host: 'redis.example.com',
            port: 6380,
            password: 'secret',
            db: 2,
            tls: true,
          },
        });

        await adapter.connect();
        expect(await adapter.ping()).toBe(true);

        await adapter.disconnect();
      });

      it('should connect using config with minimal options', async () => {
        jest.clearAllMocks();
        mockRedisInstance.ping.mockResolvedValue('PONG');

        const adapter = new RedisStorageAdapter({
          config: { host: 'localhost' },
        });

        await adapter.connect();
        expect(await adapter.ping()).toBe(true);

        await adapter.disconnect();
      });
    });

    describe('SCAN cursor pagination', () => {
      it('should handle multiple SCAN iterations', async () => {
        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379', keyPrefix: 'app:' });
        await adapter.connect();

        // Mock SCAN to return multiple pages
        mockRedisInstance.scan
          .mockResolvedValueOnce(['100', ['app:key1', 'app:key2']])
          .mockResolvedValueOnce(['200', ['app:key3', 'app:key4']])
          .mockResolvedValueOnce(['0', ['app:key5']]);

        const keys = await adapter.keys('*');

        expect(keys).toEqual(['key1', 'key2', 'key3', 'key4', 'key5']);
        expect(mockRedisInstance.scan).toHaveBeenCalledTimes(3);

        await adapter.disconnect();
      });

      it('should handle empty SCAN result', async () => {
        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });
        await adapter.connect();

        mockRedisInstance.scan.mockResolvedValueOnce(['0', []]);

        const keys = await adapter.keys('pattern:*');

        expect(keys).toEqual([]);
        expect(mockRedisInstance.scan).toHaveBeenCalledTimes(1);

        await adapter.disconnect();
      });
    });

    describe('Pub/Sub with subscriber creation', () => {
      it('should create subscriber on first subscribe call', async () => {
        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });
        await adapter.connect();

        const mockSubscriber = {
          ...createMockRedisClient(),
          on: jest.fn(),
          subscribe: jest.fn().mockResolvedValue(1),
          unsubscribe: jest.fn().mockResolvedValue(1),
          quit: jest.fn().mockResolvedValue('OK'),
        };

        // Reset the MockRedisClass to return a new subscriber
        MockRedisClass.mockImplementationOnce(() => mockSubscriber);

        const handler = jest.fn();
        const unsubscribe = await adapter.subscribe('channel', handler);

        expect(typeof unsubscribe).toBe('function');

        // Clean up
        await unsubscribe();
        await adapter.disconnect();
      });

      it('should clean up subscriber on disconnect', async () => {
        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });
        await adapter.connect();

        const mockSubscriber = {
          ...createMockRedisClient(),
          on: jest.fn(),
          subscribe: jest.fn().mockResolvedValue(1),
          unsubscribe: jest.fn().mockResolvedValue(1),
          quit: jest.fn().mockResolvedValue('OK'),
        };

        MockRedisClass.mockImplementationOnce(() => mockSubscriber);

        const handler = jest.fn();
        await adapter.subscribe('channel', handler);

        // Disconnect should clean up subscriber
        await adapter.disconnect();

        expect(mockSubscriber.quit).toHaveBeenCalled();
      });
    });

    describe('Connection error handling', () => {
      it('should wrap connection errors in StorageConnectionError', async () => {
        mockRedisInstance.ping.mockRejectedValue(new Error('ECONNREFUSED'));

        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

        await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
        await expect(adapter.connect()).rejects.toThrow('Failed to connect to Redis');
      });

      it('should handle non-Error throws during connection', async () => {
        mockRedisInstance.ping.mockRejectedValue('string error');

        const adapter = new RedisStorageAdapter({ url: 'redis://localhost:6379' });

        await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
      });
    });
  });
});
