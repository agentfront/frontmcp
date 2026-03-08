/**
 * RedisCimdCache Tests
 *
 * Tests the Redis-backed CIMD cache implementation.
 * Uses mocked RedisStorageAdapter and sha256Hex.
 */

// ---- Mocks ----

const mockRedisConnect = jest.fn().mockResolvedValue(undefined);
const mockRedisDisconnect = jest.fn().mockResolvedValue(undefined);
const mockRedisGet = jest.fn().mockResolvedValue(null);
const mockRedisSet = jest.fn().mockResolvedValue(undefined);
const mockRedisDelete = jest.fn().mockResolvedValue(true);
const mockRedisKeys = jest.fn().mockResolvedValue([]);
const mockRedisMdelete = jest.fn().mockResolvedValue(undefined);

jest.mock('@frontmcp/utils', () => ({
  RedisStorageAdapter: jest.fn().mockImplementation(() => ({
    connect: mockRedisConnect,
    disconnect: mockRedisDisconnect,
    get: mockRedisGet,
    set: mockRedisSet,
    delete: mockRedisDelete,
    keys: mockRedisKeys,
    mdelete: mockRedisMdelete,
  })),
  sha256Hex: jest.fn((input: string) => `sha256_${input}`),
}));

import { RedisCimdCache } from '../cimd-redis.cache';
import { RedisStorageAdapter, sha256Hex } from '@frontmcp/utils';
import type { ClientMetadataDocument, CimdCacheConfig } from '../cimd.types';

// Helper to create RedisCimdCache with partial config (the constructor handles defaults via ??)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createCache(config: any): RedisCimdCache {
  return new RedisCimdCache(config);
}

// ---- Test Helpers ----

function makeDocument(overrides?: Partial<ClientMetadataDocument>): ClientMetadataDocument {
  return {
    client_id: 'https://example.com/client',
    client_name: 'Test Client',
    redirect_uris: ['https://example.com/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    ...overrides,
  };
}

function makeHeaders(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) {
    h.set(k, v);
  }
  return h;
}

function makeCacheEntry(overrides?: Record<string, unknown>) {
  return {
    document: makeDocument(),
    expiresAt: Date.now() + 3600_000,
    etag: '"abc123"',
    lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
    cachedAt: Date.now(),
    ...overrides,
  };
}

// ---- Tests ----

describe('RedisCimdCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // Constructor
  // ========================================

  describe('constructor', () => {
    it('should throw when redis config is missing', () => {
      expect(() => createCache({})).toThrow('Redis configuration is required');
    });

    it('should create instance with URL-based redis config', () => {
      const cache = createCache({
        redis: { url: 'redis://localhost:6379', keyPrefix: 'test:' },
      });
      expect(cache).toBeInstanceOf(RedisCimdCache);
      expect(RedisStorageAdapter).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    });

    it('should create instance with host-based redis config', () => {
      const cache = createCache({
        redis: {
          host: 'redis-server',
          port: 6380,
          password: 'secret',
          db: 2,
          tls: true,
          keyPrefix: 'cimd-test:',
        },
      });
      expect(cache).toBeInstanceOf(RedisCimdCache);
      expect(RedisStorageAdapter).toHaveBeenCalledWith({
        config: {
          host: 'redis-server',
          port: 6380,
          password: 'secret',
          db: 2,
          tls: true,
        },
      });
    });

    it('should use default keyPrefix when not provided', () => {
      const cache = createCache({
        redis: { url: 'redis://localhost:6379' },
      });
      expect(cache).toBeInstanceOf(RedisCimdCache);
    });

    it('should apply default TTL config values', () => {
      const cache = createCache({
        redis: { url: 'redis://localhost:6379' },
      });
      // Access protected config via any to verify defaults
      const config = (cache as unknown as { config: { defaultTtlMs: number; maxTtlMs: number; minTtlMs: number } })
        .config;
      expect(config.defaultTtlMs).toBe(3600_000);
      expect(config.maxTtlMs).toBe(86400_000);
      expect(config.minTtlMs).toBe(60_000);
    });

    it('should accept custom TTL config', () => {
      const cache = createCache({
        redis: { url: 'redis://localhost:6379' },
        defaultTtlMs: 5000,
        maxTtlMs: 10000,
        minTtlMs: 1000,
      });
      const config = (cache as unknown as { config: { defaultTtlMs: number; maxTtlMs: number; minTtlMs: number } })
        .config;
      expect(config.defaultTtlMs).toBe(5000);
      expect(config.maxTtlMs).toBe(10000);
      expect(config.minTtlMs).toBe(1000);
    });

    it('should create RedisStorageAdapter with empty options when neither url nor host is provided', () => {
      const cache = createCache({
        redis: { keyPrefix: 'test:' },
      });
      expect(cache).toBeInstanceOf(RedisCimdCache);
      expect(RedisStorageAdapter).toHaveBeenCalledWith({});
    });
  });

  // ========================================
  // connect / close
  // ========================================

  describe('connect', () => {
    it('should call redis.connect()', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      await cache.connect();
      expect(mockRedisConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('should call redis.disconnect()', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      await cache.close();
      expect(mockRedisDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // get
  // ========================================

  describe('get', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should return undefined when key is not in Redis', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.get('client-1');
      expect(result).toBeUndefined();
      expect(sha256Hex).toHaveBeenCalledWith('client-1');
    });

    it('should return entry when valid and not expired', async () => {
      const entry = makeCacheEntry({ expiresAt: Date.now() + 60_000 });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.get('client-1');
      expect(result).toBeDefined();
      expect(result!.document).toEqual(entry.document);
      expect(result!.etag).toBe('"abc123"');
    });

    it('should return undefined for expired entry', async () => {
      const entry = makeCacheEntry({ expiresAt: Date.now() - 1000 });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.get('client-1');
      expect(result).toBeUndefined();
    });

    it('should delete and return undefined for invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('not-valid-json');

      const result = await cache.get('client-1');
      expect(result).toBeUndefined();
      expect(mockRedisDelete).toHaveBeenCalled();
    });

    it('should use sha256Hex-based key with prefix', async () => {
      mockRedisGet.mockResolvedValue(null);
      await cache.get('https://example.com/oauth/client');

      const expectedKey = 'cimd:sha256_https://example.com/oauth/client';
      expect(mockRedisGet).toHaveBeenCalledWith(expectedKey);
    });
  });

  // ========================================
  // getStale
  // ========================================

  describe('getStale', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should return undefined when not cached', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.getStale('client-1');
      expect(result).toBeUndefined();
    });

    it('should return entry even if expired', async () => {
      const entry = makeCacheEntry({ expiresAt: Date.now() - 999_999 });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.getStale('client-1');
      expect(result).toBeDefined();
      expect(result!.document).toEqual(entry.document);
    });

    it('should return undefined for invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('{broken');
      const result = await cache.getStale('client-1');
      expect(result).toBeUndefined();
    });
  });

  // ========================================
  // set
  // ========================================

  describe('set', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should store a document in Redis with TTL', async () => {
      const doc = makeDocument();
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });

      await cache.set('client-1', doc, headers);

      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const [key, value, options] = mockRedisSet.mock.calls[0];
      expect(key).toBe('cimd:sha256_client-1');

      const stored = JSON.parse(value);
      expect(stored.document).toEqual(doc);
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
      expect(options.ttlSeconds).toBeGreaterThan(0);
    });

    it('should store etag and lastModified from headers', async () => {
      const doc = makeDocument();
      const headers = makeHeaders({
        'cache-control': 'max-age=600',
        etag: '"etag-value"',
        'last-modified': 'Thu, 01 Jan 2025 00:00:00 GMT',
      });

      await cache.set('client-1', doc, headers);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored.etag).toBe('"etag-value"');
      expect(stored.lastModified).toBe('Thu, 01 Jan 2025 00:00:00 GMT');
    });

    it('should set Redis TTL that is 2x maxTtlMs beyond computed TTL', async () => {
      const doc = makeDocument();
      const headers = makeHeaders({ 'cache-control': 'max-age=600' });

      await cache.set('client-1', doc, headers);

      const options = mockRedisSet.mock.calls[0][2];
      // TTL = 600_000ms, maxTtlMs = 86400_000
      // Redis TTL = Math.ceil((600_000 + 86400_000 * 2) / 1000) = 173400
      const expectedRedisTtl = Math.ceil((600_000 + 86400_000 * 2) / 1000);
      expect(options.ttlSeconds).toBe(expectedRedisTtl);
    });
  });

  // ========================================
  // revalidate
  // ========================================

  describe('revalidate', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should return false when entry does not exist', async () => {
      mockRedisGet.mockResolvedValue(null);
      const headers = makeHeaders({ 'cache-control': 'max-age=600' });
      const result = await cache.revalidate('client-1', headers);
      expect(result).toBe(false);
    });

    it('should update existing entry and return true', async () => {
      const existing = makeCacheEntry({ expiresAt: Date.now() - 1000 });
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      const headers = makeHeaders({
        'cache-control': 'max-age=600',
        etag: '"new-etag"',
        'last-modified': 'Fri, 02 Jan 2025 00:00:00 GMT',
      });

      const result = await cache.revalidate('client-1', headers);
      expect(result).toBe(true);

      // Should have called set with updated entry
      expect(mockRedisSet).toHaveBeenCalledTimes(1);
      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored.etag).toBe('"new-etag"');
      expect(stored.lastModified).toBe('Fri, 02 Jan 2025 00:00:00 GMT');
      expect(stored.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should not update etag if not present in new headers', async () => {
      const existing = makeCacheEntry({ etag: '"old-etag"' });
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      const headers = makeHeaders({ 'cache-control': 'max-age=600' });
      await cache.revalidate('client-1', headers);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored.etag).toBe('"old-etag"');
    });

    it('should return false for invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('{invalid');
      const headers = makeHeaders({ 'cache-control': 'max-age=600' });
      const result = await cache.revalidate('client-1', headers);
      expect(result).toBe(false);
    });
  });

  // ========================================
  // delete
  // ========================================

  describe('delete', () => {
    it('should call redis.delete with correct key', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisDelete.mockResolvedValue(true);

      const result = await cache.delete('client-1');
      expect(result).toBe(true);
      expect(mockRedisDelete).toHaveBeenCalledWith('cimd:sha256_client-1');
    });

    it('should return false when key does not exist', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisDelete.mockResolvedValue(false);

      const result = await cache.delete('client-1');
      expect(result).toBe(false);
    });
  });

  // ========================================
  // getConditionalHeaders
  // ========================================

  describe('getConditionalHeaders', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should return undefined when not cached', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toBeUndefined();
    });

    it('should return If-None-Match when etag is present', async () => {
      const entry = makeCacheEntry({ etag: '"abc"', lastModified: undefined });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toEqual({ 'If-None-Match': '"abc"' });
    });

    it('should return If-Modified-Since when lastModified is present', async () => {
      const entry = makeCacheEntry({ etag: undefined, lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toEqual({ 'If-Modified-Since': 'Wed, 01 Jan 2025 00:00:00 GMT' });
    });

    it('should return both headers when both are present', async () => {
      const entry = makeCacheEntry({ etag: '"abc"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toEqual({
        'If-None-Match': '"abc"',
        'If-Modified-Since': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
    });

    it('should return undefined when entry has no etag or lastModified', async () => {
      const entry = makeCacheEntry({ etag: undefined, lastModified: undefined });
      mockRedisGet.mockResolvedValue(JSON.stringify(entry));

      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid JSON', async () => {
      mockRedisGet.mockResolvedValue('not-json');
      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toBeUndefined();
    });
  });

  // ========================================
  // clear
  // ========================================

  describe('clear', () => {
    it('should delete all keys with prefix', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisKeys.mockResolvedValue(['cimd:key1', 'cimd:key2', 'cimd:key3']);

      await cache.clear();

      expect(mockRedisKeys).toHaveBeenCalledWith('cimd:*');
      expect(mockRedisMdelete).toHaveBeenCalledWith(['cimd:key1', 'cimd:key2', 'cimd:key3']);
    });

    it('should not call mdelete when no keys found', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisKeys.mockResolvedValue([]);

      await cache.clear();

      expect(mockRedisKeys).toHaveBeenCalledWith('cimd:*');
      expect(mockRedisMdelete).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // size
  // ========================================

  describe('size', () => {
    it('should return count of keys with prefix', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisKeys.mockResolvedValue(['cimd:a', 'cimd:b']);

      const result = await cache.size();
      expect(result).toBe(2);
      expect(mockRedisKeys).toHaveBeenCalledWith('cimd:*');
    });

    it('should return 0 when no keys exist', async () => {
      const cache = createCache({ redis: { url: 'redis://localhost' } });
      mockRedisKeys.mockResolvedValue([]);

      const result = await cache.size();
      expect(result).toBe(0);
    });
  });

  // ========================================
  // cleanup
  // ========================================

  describe('cleanup', () => {
    let cache: RedisCimdCache;

    beforeEach(() => {
      cache = createCache({ redis: { url: 'redis://localhost' } });
    });

    it('should return 0 when no keys exist', async () => {
      mockRedisKeys.mockResolvedValue([]);
      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });

    it('should remove entries that are very old (past expiresAt + 2*maxTtl)', async () => {
      const now = Date.now();
      const veryOldEntry = makeCacheEntry({
        // expiresAt + 2 * maxTtlMs < now
        expiresAt: now - 86400_000 * 2 - 1000,
      });

      mockRedisKeys.mockResolvedValue(['cimd:old-key']);
      mockRedisGet.mockResolvedValue(JSON.stringify(veryOldEntry));
      mockRedisDelete.mockResolvedValue(true);

      const removed = await cache.cleanup();
      expect(removed).toBe(1);
      expect(mockRedisDelete).toHaveBeenCalledWith('cimd:old-key');
    });

    it('should not remove recently expired entries', async () => {
      const recentEntry = makeCacheEntry({
        expiresAt: Date.now() - 1000, // Expired 1 second ago, but within 2*maxTtl
      });

      mockRedisKeys.mockResolvedValue(['cimd:recent-key']);
      mockRedisGet.mockResolvedValue(JSON.stringify(recentEntry));

      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });

    it('should remove entries with invalid JSON', async () => {
      mockRedisKeys.mockResolvedValue(['cimd:bad-key']);
      mockRedisGet.mockResolvedValue('invalid-json');
      mockRedisDelete.mockResolvedValue(true);

      const removed = await cache.cleanup();
      expect(removed).toBe(1);
      expect(mockRedisDelete).toHaveBeenCalledWith('cimd:bad-key');
    });

    it('should skip keys where redis.get returns null', async () => {
      mockRedisKeys.mockResolvedValue(['cimd:gone-key']);
      mockRedisGet.mockResolvedValue(null);

      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });

    it('should handle mixed entries (old + recent + invalid)', async () => {
      const now = Date.now();
      const veryOldEntry = makeCacheEntry({ expiresAt: now - 86400_000 * 3 });
      const recentEntry = makeCacheEntry({ expiresAt: now + 60_000 });

      mockRedisKeys.mockResolvedValue(['cimd:old', 'cimd:recent', 'cimd:invalid']);

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(veryOldEntry))
        .mockResolvedValueOnce(JSON.stringify(recentEntry))
        .mockResolvedValueOnce('bad-json');

      mockRedisDelete.mockResolvedValue(true);

      const removed = await cache.cleanup();
      expect(removed).toBe(2); // old + invalid
    });
  });

  // ========================================
  // Custom keyPrefix
  // ========================================

  describe('custom keyPrefix', () => {
    it('should use custom keyPrefix for cache keys', async () => {
      const cache = createCache({
        redis: { url: 'redis://localhost', keyPrefix: 'custom:prefix:' },
      });

      mockRedisGet.mockResolvedValue(null);
      await cache.get('client-1');

      expect(mockRedisGet).toHaveBeenCalledWith('custom:prefix:sha256_client-1');
    });

    it('should use custom keyPrefix for clear and size', async () => {
      const cache = createCache({
        redis: { url: 'redis://localhost', keyPrefix: 'myprefix:' },
      });

      mockRedisKeys.mockResolvedValue([]);
      await cache.clear();
      expect(mockRedisKeys).toHaveBeenCalledWith('myprefix:*');

      await cache.size();
      expect(mockRedisKeys).toHaveBeenCalledWith('myprefix:*');
    });
  });
});
