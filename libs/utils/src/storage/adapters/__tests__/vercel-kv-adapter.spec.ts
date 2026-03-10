/**
 * Vercel KV Storage Adapter Tests
 *
 * Comprehensive tests for VercelKvStorageAdapter with mocked @vercel/kv.
 */

import { VercelKvStorageAdapter } from '../vercel-kv';
import { StorageConfigError, StorageConnectionError } from '../../errors';

// Mock Vercel KV client
const createMockVercelKvClient = () => ({
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
  keys: jest.fn(),
});

const mockKvClient = createMockVercelKvClient();
const mockCreateClient = jest.fn(() => createMockVercelKvClient());

jest.mock('@vercel/kv', () => ({
  kv: mockKvClient,
  createClient: mockCreateClient,
}));

describe('VercelKvStorageAdapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock client
    Object.assign(mockKvClient, createMockVercelKvClient());

    // Clear environment variables
    delete process.env['KV_REST_API_URL'];
    delete process.env['KV_REST_API_TOKEN'];

    // Default mock implementations
    mockKvClient.exists.mockResolvedValue(1);
    mockKvClient.get.mockResolvedValue(null);
    mockKvClient.set.mockResolvedValue('OK');
    mockKvClient.del.mockResolvedValue(1);
    mockKvClient.expire.mockResolvedValue(1);
    mockKvClient.ttl.mockResolvedValue(60);
    mockKvClient.incr.mockResolvedValue(1);
    mockKvClient.decr.mockResolvedValue(0);
    mockKvClient.incrby.mockResolvedValue(5);
    mockKvClient.mget.mockResolvedValue([]);
    mockKvClient.scan.mockResolvedValue([0, []]);
    mockKvClient.keys.mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Constructor', () => {
    it('should throw StorageConfigError when url and token not provided', () => {
      expect(() => new VercelKvStorageAdapter()).toThrow(StorageConfigError);
      expect(() => new VercelKvStorageAdapter({})).toThrow(StorageConfigError);
    });

    it('should throw StorageConfigError when only url provided', () => {
      expect(() => new VercelKvStorageAdapter({ url: 'https://example.vercel.storage' })).toThrow(StorageConfigError);
    });

    it('should throw StorageConfigError when only token provided', () => {
      expect(() => new VercelKvStorageAdapter({ token: 'token123' })).toThrow(StorageConfigError);
    });

    it('should read KV_REST_API_URL and KV_REST_API_TOKEN from environment', () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();
      expect(adapter).toBeInstanceOf(VercelKvStorageAdapter);
    });

    it('should use options over environment variables', () => {
      process.env['KV_REST_API_URL'] = 'https://env.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'env-token';

      const adapter = new VercelKvStorageAdapter({
        url: 'https://options.vercel.storage',
        token: 'options-token',
      });
      expect(adapter).toBeInstanceOf(VercelKvStorageAdapter);
    });

    it('should apply custom keyPrefix', () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter({ keyPrefix: 'myapp:' });
      expect(adapter).toBeInstanceOf(VercelKvStorageAdapter);
    });
  });

  describe('Connection Lifecycle', () => {
    it('should connect using default kv singleton when URL matches env', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
      expect(mockKvClient.exists).toHaveBeenCalledWith('__healthcheck__');
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it('should connect using createClient when URL differs from env', async () => {
      process.env['KV_REST_API_URL'] = 'https://env.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'env-token';

      const customClient = createMockVercelKvClient();
      customClient.exists.mockResolvedValue(1);
      mockCreateClient.mockReturnValue(customClient);

      const adapter = new VercelKvStorageAdapter({
        url: 'https://custom.vercel.storage',
        token: 'custom-token',
      });

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
      expect(mockCreateClient).toHaveBeenCalledWith({
        url: 'https://custom.vercel.storage',
        token: 'custom-token',
      });
    });

    it('should not reconnect if already connected', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await adapter.connect();
      await adapter.connect();

      // exists should only be called once during connect
      expect(mockKvClient.exists).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageConnectionError on connection failure', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      mockKvClient.exists.mockRejectedValue(new Error('Connection failed'));

      const adapter = new VercelKvStorageAdapter();

      await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
    });

    it('should disconnect (REST-based, just resets state)', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await adapter.connect();
      await adapter.disconnect();

      expect(await adapter.ping()).toBe(false);
    });

    it('should return true from ping when connected', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await adapter.connect();

      expect(await adapter.ping()).toBe(true);
    });

    it('should return false from ping when not connected', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      expect(await adapter.ping()).toBe(false);
    });

    it('should return false from ping on error', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await adapter.connect();
      mockKvClient.exists.mockRejectedValue(new Error('Connection lost'));

      expect(await adapter.ping()).toBe(false);
    });
  });

  describe('Core Operations', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter({ keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('get()', () => {
      it('should get value with prefix', async () => {
        mockKvClient.get.mockResolvedValue('value');

        const result = await adapter.get('key');

        expect(mockKvClient.get).toHaveBeenCalledWith('test:key');
        expect(result).toBe('value');
      });

      it('should return null for non-existing key', async () => {
        mockKvClient.get.mockResolvedValue(null);

        const result = await adapter.get('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('set()', () => {
      it('should set value with prefix', async () => {
        await adapter.set('key', 'value');

        expect(mockKvClient.set).toHaveBeenCalledWith('test:key', 'value', undefined);
      });

      it('should set value with TTL', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300 });

        expect(mockKvClient.set).toHaveBeenCalledWith('test:key', 'value', { ex: 300 });
      });

      it('should set value with NX option', async () => {
        await adapter.set('key', 'value', { ifNotExists: true });

        expect(mockKvClient.set).toHaveBeenCalledWith('test:key', 'value', { nx: true });
      });

      it('should set value with XX option', async () => {
        await adapter.set('key', 'value', { ifExists: true });

        expect(mockKvClient.set).toHaveBeenCalledWith('test:key', 'value', { xx: true });
      });

      it('should set value with TTL and NX', async () => {
        await adapter.set('key', 'value', { ttlSeconds: 300, ifNotExists: true });

        expect(mockKvClient.set).toHaveBeenCalledWith('test:key', 'value', { ex: 300, nx: true });
      });
    });

    describe('delete()', () => {
      it('should delete key with prefix', async () => {
        mockKvClient.del.mockResolvedValue(1);

        const result = await adapter.delete('key');

        expect(mockKvClient.del).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockKvClient.del.mockResolvedValue(0);

        const result = await adapter.delete('nonexistent');

        expect(result).toBe(false);
      });
    });

    describe('exists()', () => {
      it('should check existence with prefix', async () => {
        mockKvClient.exists.mockResolvedValue(1);

        const result = await adapter.exists('key');

        expect(mockKvClient.exists).toHaveBeenCalledWith('test:key');
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockKvClient.exists.mockResolvedValue(0);

        const result = await adapter.exists('nonexistent');

        expect(result).toBe(false);
      });
    });
  });

  describe('Batch Operations', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter({ keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('mget()', () => {
      it('should get multiple values with prefix', async () => {
        mockKvClient.mget.mockResolvedValue(['value1', 'value2', null]);

        const result = await adapter.mget(['key1', 'key2', 'key3']);

        expect(mockKvClient.mget).toHaveBeenCalledWith('test:key1', 'test:key2', 'test:key3');
        expect(result).toEqual(['value1', 'value2', null]);
      });

      it('should return empty array for empty input', async () => {
        const result = await adapter.mget([]);

        expect(result).toEqual([]);
        expect(mockKvClient.mget).not.toHaveBeenCalled();
      });
    });

    describe('mdelete()', () => {
      it('should delete multiple keys with prefix', async () => {
        mockKvClient.del.mockResolvedValue(2);

        const result = await adapter.mdelete(['key1', 'key2']);

        expect(mockKvClient.del).toHaveBeenCalledWith('test:key1', 'test:key2');
        expect(result).toBe(2);
      });

      it('should return 0 for empty input', async () => {
        const result = await adapter.mdelete([]);

        expect(result).toBe(0);
        expect(mockKvClient.del).not.toHaveBeenCalled();
      });
    });
  });

  describe('TTL Operations', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter({ keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('expire()', () => {
      it('should set TTL on key', async () => {
        mockKvClient.expire.mockResolvedValue(1);

        const result = await adapter.expire('key', 300);

        expect(mockKvClient.expire).toHaveBeenCalledWith('test:key', 300);
        expect(result).toBe(true);
      });

      it('should return false when key not found', async () => {
        mockKvClient.expire.mockResolvedValue(0);

        const result = await adapter.expire('nonexistent', 300);

        expect(result).toBe(false);
      });
    });

    describe('ttl()', () => {
      it('should return TTL for key with expiry', async () => {
        mockKvClient.ttl.mockResolvedValue(250);

        const result = await adapter.ttl('key');

        expect(mockKvClient.ttl).toHaveBeenCalledWith('test:key');
        expect(result).toBe(250);
      });

      it('should return null when key does not exist', async () => {
        mockKvClient.ttl.mockResolvedValue(-2);

        const result = await adapter.ttl('nonexistent');

        expect(result).toBeNull();
      });

      it('should return -1 when key has no TTL', async () => {
        mockKvClient.ttl.mockResolvedValue(-1);

        const result = await adapter.ttl('key');

        expect(result).toBe(-1);
      });
    });
  });

  describe('Key Enumeration', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter({ keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('keys()', () => {
      it('should use SCAN and remove prefix', async () => {
        mockKvClient.scan
          .mockResolvedValueOnce([10, ['test:key1', 'test:key2']])
          .mockResolvedValueOnce([0, ['test:key3']]);

        const result = await adapter.keys('*');

        expect(mockKvClient.scan).toHaveBeenCalledWith(0, { match: 'test:*', count: 100 });
        expect(result).toEqual(['key1', 'key2', 'key3']);
      });

      it('should handle string cursor from scan', async () => {
        mockKvClient.scan.mockResolvedValueOnce(['10', ['test:key1']]).mockResolvedValueOnce(['0', ['test:key2']]);

        const result = await adapter.keys('*');

        expect(result).toEqual(['key1', 'key2']);
      });

      it('should handle NaN cursor gracefully', async () => {
        mockKvClient.scan.mockResolvedValueOnce(['invalid', ['test:key1']]);

        const result = await adapter.keys('*');

        expect(result).toEqual(['key1']);
      });

      it('should fallback to keys command when scan fails', async () => {
        mockKvClient.scan.mockRejectedValue(new Error('SCAN not supported'));
        mockKvClient.keys.mockResolvedValue(['test:key1', 'test:key2']);

        const result = await adapter.keys('*');

        expect(mockKvClient.keys).toHaveBeenCalledWith('test:*');
        expect(result).toEqual(['key1', 'key2']);
      });

      it('should return empty array when no keys match', async () => {
        mockKvClient.scan.mockResolvedValue([0, []]);

        const result = await adapter.keys('nonexistent:*');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Atomic Operations', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter({ keyPrefix: 'test:' });
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('incr()', () => {
      it('should increment key with prefix', async () => {
        mockKvClient.incr.mockResolvedValue(5);

        const result = await adapter.incr('counter');

        expect(mockKvClient.incr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(5);
      });
    });

    describe('decr()', () => {
      it('should decrement key with prefix', async () => {
        mockKvClient.decr.mockResolvedValue(3);

        const result = await adapter.decr('counter');

        expect(mockKvClient.decr).toHaveBeenCalledWith('test:counter');
        expect(result).toBe(3);
      });
    });

    describe('incrBy()', () => {
      it('should increment key by amount with prefix', async () => {
        mockKvClient.incrby.mockResolvedValue(10);

        const result = await adapter.incrBy('counter', 5);

        expect(mockKvClient.incrby).toHaveBeenCalledWith('test:counter', 5);
        expect(result).toBe(10);
      });
    });
  });

  describe('Pub/Sub', () => {
    let adapter: VercelKvStorageAdapter;

    beforeEach(async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      adapter = new VercelKvStorageAdapter();
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    describe('supportsPubSub()', () => {
      it('should return false', () => {
        expect(adapter.supportsPubSub()).toBe(false);
      });
    });

    describe('publish()', () => {
      it('should throw not supported error', async () => {
        await expect(adapter.publish('channel', 'message')).rejects.toThrow('is not supported');
      });
    });

    describe('subscribe()', () => {
      it('should throw not supported error', async () => {
        await expect(adapter.subscribe('channel', jest.fn())).rejects.toThrow('is not supported');
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw when operations called before connect', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();

      await expect(adapter.get('key')).rejects.toThrow('is not connected');
    });
  });

  describe('Key Prefix Handling', () => {
    it('should work without prefix', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter();
      await adapter.connect();

      mockKvClient.get.mockResolvedValue('value');

      await adapter.get('key');

      expect(mockKvClient.get).toHaveBeenCalledWith('key');

      await adapter.disconnect();
    });

    it('should correctly unprefix keys', async () => {
      process.env['KV_REST_API_URL'] = 'https://example.vercel.storage';
      process.env['KV_REST_API_TOKEN'] = 'token123';

      const adapter = new VercelKvStorageAdapter({ keyPrefix: 'prefix:' });
      await adapter.connect();

      mockKvClient.scan.mockResolvedValue([0, ['prefix:key1', 'prefix:key2', 'other:key3']]);

      const result = await adapter.keys('*');

      expect(result).toContain('key1');
      expect(result).toContain('key2');
      expect(result).toContain('other:key3'); // No prefix to remove

      await adapter.disconnect();
    });
  });
});
