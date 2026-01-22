/**
 * Upstash Storage Adapter Tests
 *
 * Comprehensive tests for UpstashStorageAdapter with mocked @upstash/redis.
 */

import { UpstashStorageAdapter } from '../upstash';
import { StorageConfigError, StorageConnectionError } from '../../errors';

// Mock Upstash Redis client
const createMockUpstashClient = () => ({
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
  lpush: jest.fn(),
  brpop: jest.fn(),
  rpop: jest.fn(),
});

const mockUpstashClient = createMockUpstashClient();
const MockUpstashRedis = jest.fn(() => mockUpstashClient);

jest.mock('@upstash/redis', () => ({
  Redis: MockUpstashRedis,
}));

describe('UpstashStorageAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Reset mock client
    Object.assign(mockUpstashClient, createMockUpstashClient());

    // Clear environment variables
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];

    // Default mock implementations
    mockUpstashClient.exists.mockResolvedValue(1);
    mockUpstashClient.get.mockResolvedValue(null);
    mockUpstashClient.set.mockResolvedValue('OK');
    mockUpstashClient.del.mockResolvedValue(1);
    mockUpstashClient.expire.mockResolvedValue(1);
    mockUpstashClient.ttl.mockResolvedValue(60);
    mockUpstashClient.incr.mockResolvedValue(1);
    mockUpstashClient.decr.mockResolvedValue(0);
    mockUpstashClient.incrby.mockResolvedValue(5);
    mockUpstashClient.publish.mockResolvedValue(1);
    mockUpstashClient.lpush.mockResolvedValue(1);
    mockUpstashClient.rpop.mockResolvedValue(null);
    mockUpstashClient.mget.mockResolvedValue([]);
    mockUpstashClient.scan.mockResolvedValue([0, []]);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  describe('Constructor', () => {
    it('should throw StorageConfigError when url and token not provided', () => {
      expect(() => new UpstashStorageAdapter()).toThrow(StorageConfigError);
      expect(() => new UpstashStorageAdapter({})).toThrow(StorageConfigError);
    });

    it('should throw StorageConfigError when only url provided', () => {
      expect(() => new UpstashStorageAdapter({ url: 'https://example.upstash.io' })).toThrow(StorageConfigError);
    });

    it('should throw StorageConfigError when only token provided', () => {
      expect(() => new UpstashStorageAdapter({ token: 'token123' })).toThrow(StorageConfigError);
    });

    it('should read UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from environment', () => {
      process.env['UPSTASH_REDIS_REST_URL'] = 'https://example.upstash.io';
      process.env['UPSTASH_REDIS_REST_TOKEN'] = 'token123';

      const adapter = new UpstashStorageAdapter();
      expect(adapter).toBeInstanceOf(UpstashStorageAdapter);
    });

    it('should use options over environment variables', () => {
      process.env['UPSTASH_REDIS_REST_URL'] = 'https://env.upstash.io';
      process.env['UPSTASH_REDIS_REST_TOKEN'] = 'env-token';

      const adapter = new UpstashStorageAdapter({
        url: 'https://options.upstash.io',
        token: 'options-token',
      });
      expect(adapter).toBeInstanceOf(UpstashStorageAdapter);
    });

    it('should apply custom keyPrefix', () => {
      process.env['UPSTASH_REDIS_REST_URL'] = 'https://example.upstash.io';
      process.env['UPSTASH_REDIS_REST_TOKEN'] = 'token123';

      const adapter = new UpstashStorageAdapter({ keyPrefix: 'myapp:' });
      expect(adapter).toBeInstanceOf(UpstashStorageAdapter);
    });

    it('should default enablePubSub to false', () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      expect(adapter.supportsPubSub()).toBe(false);
    });

    it('should enable pub/sub when enablePubSub is true', () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        enablePubSub: true,
      });

      expect(adapter.supportsPubSub()).toBe(true);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should connect successfully', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
      expect(mockUpstashClient.exists).toHaveBeenCalledWith('__healthcheck__');
    });

    it('should not reconnect if already connected', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await adapter.connect();
      await adapter.connect();

      expect(MockUpstashRedis).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageConnectionError on connection failure', async () => {
      mockUpstashClient.exists.mockRejectedValue(new Error('Connection failed'));

      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
    });

    it('should disconnect and cleanup', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        enablePubSub: true,
      });

      await adapter.connect();
      await adapter.subscribe('channel', jest.fn());

      await adapter.disconnect();

      expect(await adapter.ping()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });

    it('should return true from ping when connected', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
    });

    it('should return false from ping when not connected', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      expect(await adapter.ping()).toBe(false);
    });

    it('should return false from ping on error', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await adapter.connect();
      mockUpstashClient.exists.mockRejectedValue(new Error('Connection lost'));

      expect(await adapter.ping()).toBe(false);
    });
  });

  describe('Core Operations', () => {
    let adapter: UpstashStorageAdapter;

    beforeEach(async () => {
      adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('get()', () => {
      it('should get value with prefix', async () => {
        mockUpstashClient.get.mockResolvedValue('value');

        const result = await adapter.get('key');

        expect(mockUpstashClient.get).toHaveBeenCalledWith('test:key');
        expect(result).toBe('value');
      });

      it('should return null for non-existing key', async () => {
        mockUpstashClient.get.mockResolvedValue(null);

        const result = await adapter.get('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('set()', () => {
      it('should set value with prefix', async () => {
        await adapter.set('key', 'value');

        expect(mockUpstashClient.set).toHaveBeenCalledWith('test:key', 'value', undefined);
      });

      it('should set value with TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300 });

        expect(mockUpstashClient.set).toHaveBeenCalledWith('test:key', 'value', { ex: 300 });
      });

      it('should set value with NX option', async () => {
        await adapter.set('key', 'value', { ifNotExists: true });

        expect(mockUpstashClient.set).toHaveBeenCalledWith('test:key', 'value', { nx: true });
      });

      it('should set value with XX option', async () => {
        await adapter.set('key', 'value', { ifExists: true });

        expect(mockUpstashClient.set).toHaveBeenCalledWith('test:key', 'value', { xx: true });
      });

      it('should set value with TTL and NX', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300, ifNotExists: true });

        expect(mockUpstashClient.set).toHaveBeenCalledWith('test:key', 'value', { ex: 300, nx: true });
      });
    });

    describe('delete()', () => {
      it('should delete key with prefix', async () => {
        mockUpstashClient.del.mockResolvedValue(1);

        const result = await adapter.delete('key');

        expect(mockUpstashClient.del).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockUpstashClient.del.mockResolvedValue(0);

        const result = await adapter.delete('nonexistent');

        expect(result).toBe(false);
      });
    });

    describe('exists()', () => {
      it('should check existence with prefix', async () => {
        mockUpstashClient.exists.mockResolvedValue(1);

        const result = await adapter.exists('key');

        expect(mockUpstashClient.exists).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockUpstashClient.exists.mockResolvedValue(0);

        const result = await adapter.exists('nonexistent');

        expect(result).toBe(false);
      });
    });
  });

  describe('Batch Operations', () => {
    let adapter: UpstashStorageAdapter;

    beforeEach(async () => {
      adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('mget()', () => {
      it('should get multiple values with prefix', async () => {
        mockUpstashClient.mget.mockResolvedValue(['value1', 'value2', null]);

        const result = await adapter.mget(['key1', 'key2', 'key3']);

        expect(mockUpstashClient.mget).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
        expect(result).toEqual(['value1', 'value2', null]);
      });

      it('should return empty array for empty input', async () => {
        const result = await adapter.mget([]);

        expect(result).toEqual([]);
        expect(mockUpstashClient.mget).not.toHaveBeenCalled();
      });
    });

    describe('mdelete()', () => {
      it('should delete multiple keys with prefix', async () => {
        mockUpstashClient.del.mockResolvedValue(2);

        const result = await adapter.mdelete(['key1', 'key2']);

        expect(mockUpstashClient.del).toHaveBeenCalledWith('test:key1', 'test:key2');
        expect(result).toBe(2);
      });

      it('should return 0 for empty input', async () => {
        const result = await adapter.mdelete([]);

        expect(result).toBe(0);
        expect(mockUpstashClient.del).not.toHaveBeenCalled();
      });
    });
  });

  describe('TTL Operations', () => {
    let adapter: UpstashStorageAdapter;

    beforeEach(async () => {
      adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('expire()', () => {
      it('should set TTL on key', async () => {
        mockUpstashClient.expire.mockResolvedValue(1);

        const result = await adapter.expire('key', 300);

        expect(mockUpstashClient.expire).toHaveBeenCalledWith('test:key', 300);
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockUpstashClient.expire.mockResolvedValue(0);

        const result = await adapter.expire('nonexistent', 300);

        expect(result).toBe(false);
      });
    });

    describe('ttl()', () => {
      it('should return TTL for key with expiry', async () => {
        mockUpstashClient.ttl.mockResolvedValue(250);

        const result = await adapter.ttl('key');

        expect(mockUpstashClient.ttl).toHaveBeenCalledWith('test:key');
        expect(result).toBe(250);
      });

      it('should return null when key does not exist', async () => {
        mockUpstashClient.ttl.mockResolvedValue(-2);

        const result = await adapter.ttl('nonexistent');

        expect(result).toBeNull();
      });

      it('should return -1 when key has no TTL', async () => {
        mockUpstashClient.ttl.mockResolvedValue(-1);

        const result = await adapter.ttl('key');

        expect(result).toBe(-1);
      });
    });
  });

  describe('Key Enumeration', () => {
    let adapter: UpstashStorageAdapter;

    beforeEach(async () => {
      adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('keys()', () => {
      it('should scan keys and remove prefix', async () => {
        mockUpstashClient.scan
          .mockResolvedValueOnce([10, ['test:key1', 'test:key2']])
          .mockResolvedValueOnce([0, ['test:key3']]);

        const result = await adapter.keys('*');

        expect(mockUpstashClient.scan).toHaveBeenCalledWith(0, { match: 'test:*', count: 100 });
        expect(result).toEqual(['key1', 'key2', 'key3']);
      });

      it('should handle string cursor from scan', async () => {
        mockUpstashClient.scan.mockResolvedValueOnce(['10', ['test:key1']]).mockResolvedValueOnce(['0', ['test:key2']]);

        const result = await adapter.keys('*');

        expect(result).toEqual(['key1', 'key2']);
      });

      it('should handle NaN cursor gracefully', async () => {
        mockUpstashClient.scan.mockResolvedValueOnce(['invalid', ['test:key1']]);

        const result = await adapter.keys('*');

        expect(result).toEqual(['key1']);
      });

      it('should return empty array when no keys match', async () => {
        mockUpstashClient.scan.mockResolvedValue([0, []]);

        const result = await adapter.keys('nonexistent:*');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Atomic Operations', () => {
    let adapter: UpstashStorageAdapter;

    beforeEach(async () => {
      adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
      });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('incr()', () => {
      it('should increment key with prefix', async () => {
        mockUpstashClient.incr.mockResolvedValue(5);

        const result = await adapter.incr('counter');

        expect(mockUpstashClient.incr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(5);
      });
    });

    describe('decr()', () => {
      it('should decrement key with prefix', async () => {
        mockUpstashClient.decr.mockResolvedValue(3);

        const result = await adapter.decr('counter');

        expect(mockUpstashClient.decr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(3);
      });
    });

    describe('incrBy()', () => {
      it('should increment key by amount with prefix', async () => {
        mockUpstashClient.incrby.mockResolvedValue(10);

        const result = await adapter.incrBy('counter', 5);

        expect(mockUpstashClient.incrby).toHaveBeenCalledWith('test:counter', 5);
        expect(result).toBe(10);
      });
    });
  });

  describe('Pub/Sub', () => {
    describe('supportsPubSub()', () => {
      it('should return false when not enabled', () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
        });

        expect(adapter.supportsPubSub()).toBe(false);
      });

      it('should return true when enabled', () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          enablePubSub: true,
        });

        expect(adapter.supportsPubSub()).toBe(true);
      });
    });

    describe('publish()', () => {
      it('should throw when pub/sub not enabled', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
        });

        await adapter.connect();

        await expect(adapter.publish('channel', 'message')).rejects.toThrow('is not supported');

        await adapter.disconnect();
      });

      it('should publish message using lpush when enabled', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();
        mockUpstashClient.lpush.mockResolvedValue(1);

        const result = await adapter.publish('channel', 'message');

        expect(mockUpstashClient.lpush).toHaveBeenCalledWith('test:__pubsub__:channel:queue', 'message');
        expect(result).toBe(1);

        await adapter.disconnect();
      });
    });

    describe('subscribe()', () => {
      it('should throw when pub/sub not enabled', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
        });

        await adapter.connect();

        await expect(adapter.subscribe('channel', jest.fn())).rejects.toThrow('is not supported');

        await adapter.disconnect();
      });

      it('should subscribe and start polling when enabled', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const handler = jest.fn();
        const unsubscribe = await adapter.subscribe('channel', handler);

        expect(typeof unsubscribe).toBe('function');

        await adapter.disconnect();
      });

      it('should dispatch messages from polling', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const handler = jest.fn();
        await adapter.subscribe('channel', handler);

        // First poll returns a message
        mockUpstashClient.rpop.mockResolvedValueOnce('test message');

        // Advance timers to trigger polling
        await jest.advanceTimersByTimeAsync(100);

        expect(handler).toHaveBeenCalledWith('test message', 'channel');

        await adapter.disconnect();
      });

      it('should handle handler errors gracefully', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const errorHandler = jest.fn(() => {
          throw new Error('Handler error');
        });
        await adapter.subscribe('channel', errorHandler);

        mockUpstashClient.rpop.mockResolvedValueOnce('test message');

        // Should not throw
        await expect(jest.advanceTimersByTimeAsync(100)).resolves.not.toThrow();

        await adapter.disconnect();
      });

      it('should handle polling errors gracefully', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const handler = jest.fn();
        await adapter.subscribe('channel', handler);

        mockUpstashClient.rpop.mockRejectedValueOnce(new Error('Polling error'));

        // Should not throw
        await expect(jest.advanceTimersByTimeAsync(100)).resolves.not.toThrow();

        await adapter.disconnect();
      });

      it('should unsubscribe and stop polling', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const handler = jest.fn();
        const unsubscribe = await adapter.subscribe('channel', handler);

        await unsubscribe();

        // Verify polling stopped - no more calls after unsubscribe
        mockUpstashClient.rpop.mockClear();
        await jest.advanceTimersByTimeAsync(200);

        expect(mockUpstashClient.rpop).not.toHaveBeenCalled();

        await adapter.disconnect();
      });

      it('should handle multiple handlers on same channel', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();

        const handler1 = jest.fn();
        const handler2 = jest.fn();

        await adapter.subscribe('channel', handler1);
        const unsubscribe2 = await adapter.subscribe('channel', handler2);

        mockUpstashClient.rpop.mockResolvedValueOnce('test message');
        await jest.advanceTimersByTimeAsync(100);

        expect(handler1).toHaveBeenCalledWith('test message', 'channel');
        expect(handler2).toHaveBeenCalledWith('test message', 'channel');

        // Unsubscribe one handler
        await unsubscribe2();

        // Clear mocks and send another message
        handler1.mockClear();
        handler2.mockClear();
        mockUpstashClient.rpop.mockResolvedValueOnce('another message');
        await jest.advanceTimersByTimeAsync(100);

        expect(handler1).toHaveBeenCalledWith('another message', 'channel');
        expect(handler2).not.toHaveBeenCalled();

        await adapter.disconnect();
      });
    });

    describe('publishToQueue()', () => {
      it('should publish message to list-based queue', async () => {
        const adapter = new UpstashStorageAdapter({
          url: 'https://example.upstash.io',
          token: 'token123',
          keyPrefix: 'test:',
          enablePubSub: true,
        });

        await adapter.connect();
        mockUpstashClient.lpush.mockResolvedValue(1);

        await adapter.publishToQueue('channel', 'message');

        expect(mockUpstashClient.lpush).toHaveBeenCalledWith('test:__pubsub__:channel:queue', 'message');

        await adapter.disconnect();
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw when operations called before connect', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });

      await expect(adapter.get('key')).rejects.toThrow('is not connected');
    });
  });

  describe('Key Prefix Handling', () => {
    it('should work without prefix', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
      });
      await adapter.connect();

      mockUpstashClient.get.mockResolvedValue('value');

      await adapter.get('key');

      expect(mockUpstashClient.get).toHaveBeenCalledWith('key');

      await adapter.disconnect();
    });

    it('should correctly unprefix keys', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'prefix:',
      });
      await adapter.connect();

      mockUpstashClient.scan.mockResolvedValue([0, ['prefix:key1', 'prefix:key2', 'other:key3']]);

      const result = await adapter.keys('*');

      expect(result).toContain('key1');
      expect(result).toContain('key2');
      expect(result).toContain('other:key3'); // No prefix to remove

      await adapter.disconnect();
    });
  });

  describe('Disconnect cleanup', () => {
    it('should clear all polling intervals on disconnect', async () => {
      const adapter = new UpstashStorageAdapter({
        url: 'https://example.upstash.io',
        token: 'token123',
        keyPrefix: 'test:',
        enablePubSub: true,
      });

      await adapter.connect();

      await adapter.subscribe('channel1', jest.fn());
      await adapter.subscribe('channel2', jest.fn());

      await adapter.disconnect();

      // After disconnect, advancing timers should not cause any polling
      mockUpstashClient.rpop.mockClear();
      await jest.advanceTimersByTimeAsync(500);

      expect(mockUpstashClient.rpop).not.toHaveBeenCalled();
    });
  });
});
