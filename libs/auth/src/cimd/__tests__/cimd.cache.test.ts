/**
 * CIMD Cache Tests
 */
import { extractCacheHeaders, parseCacheHeaders, InMemoryCimdCache, createCimdCache } from '../cimd.cache';
import type { CimdCacheTtlConfig } from '../cimd.cache';
import type { ClientMetadataDocument } from '../cimd.types';
import { assertDefined } from '../../__test-utils__/assertion.helpers';

// ============================================
// Test Helpers
// ============================================

function makeHeaders(entries: Record<string, string>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) {
    h.set(k, v);
  }
  return h;
}

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

const defaultTtlConfig: CimdCacheTtlConfig = {
  defaultTtlMs: 3600_000,
  maxTtlMs: 86400_000,
  minTtlMs: 60_000,
};

// ============================================
// extractCacheHeaders
// ============================================

describe('extractCacheHeaders', () => {
  it('should extract cache-control header', () => {
    const headers = makeHeaders({ 'cache-control': 'max-age=300' });
    const result = extractCacheHeaders(headers);
    expect(result['cache-control']).toBe('max-age=300');
  });

  it('should extract expires header', () => {
    const headers = makeHeaders({ expires: 'Thu, 01 Jan 2099 00:00:00 GMT' });
    const result = extractCacheHeaders(headers);
    expect(result.expires).toBe('Thu, 01 Jan 2099 00:00:00 GMT');
  });

  it('should extract etag header', () => {
    const headers = makeHeaders({ etag: '"abc123"' });
    const result = extractCacheHeaders(headers);
    expect(result.etag).toBe('"abc123"');
  });

  it('should extract last-modified header', () => {
    const headers = makeHeaders({ 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' });
    const result = extractCacheHeaders(headers);
    expect(result['last-modified']).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('should extract age header', () => {
    const headers = makeHeaders({ age: '120' });
    const result = extractCacheHeaders(headers);
    expect(result.age).toBe('120');
  });

  it('should return undefined for missing headers', () => {
    const headers = makeHeaders({});
    const result = extractCacheHeaders(headers);
    expect(result['cache-control']).toBeUndefined();
    expect(result.expires).toBeUndefined();
    expect(result.etag).toBeUndefined();
    expect(result['last-modified']).toBeUndefined();
    expect(result.age).toBeUndefined();
  });
});

// ============================================
// parseCacheHeaders
// ============================================

describe('parseCacheHeaders', () => {
  it('should return default TTL when no relevant headers', () => {
    const result = parseCacheHeaders({}, defaultTtlConfig);
    expect(result.ttlMs).toBe(defaultTtlConfig.defaultTtlMs);
  });

  it('should parse Cache-Control max-age', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=600' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(600 * 1000);
  });

  it('should let s-maxage override max-age', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=600, s-maxage=1200' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(1200 * 1000);
  });

  it('should use minTtl for no-store directive', () => {
    const result = parseCacheHeaders({ 'cache-control': 'no-store' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(defaultTtlConfig.minTtlMs);
  });

  it('should use minTtl for no-cache directive', () => {
    const result = parseCacheHeaders({ 'cache-control': 'no-cache' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(defaultTtlConfig.minTtlMs);
  });

  it('should parse Expires header as fallback', () => {
    const futureDate = new Date(Date.now() + 300_000).toUTCString();
    const result = parseCacheHeaders({ expires: futureDate }, defaultTtlConfig);
    // Should be approximately 300 seconds (within margin for test execution time)
    expect(result.ttlMs).toBeGreaterThan(290_000);
    expect(result.ttlMs).toBeLessThanOrEqual(300_000);
  });

  it('should prefer Cache-Control over Expires', () => {
    const futureDate = new Date(Date.now() + 999_000).toUTCString();
    const result = parseCacheHeaders({ 'cache-control': 'max-age=120', expires: futureDate }, defaultTtlConfig);
    expect(result.ttlMs).toBe(120 * 1000);
  });

  it('should subtract age from max-age', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=600', age: '100' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(500 * 1000);
  });

  it('should subtract age from s-maxage', () => {
    const result = parseCacheHeaders({ 'cache-control': 's-maxage=600', age: '100' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(500 * 1000);
  });

  it('should clamp TTL to maxTtlMs', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=999999' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(defaultTtlConfig.maxTtlMs);
  });

  it('should clamp TTL to minTtlMs', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=1' }, defaultTtlConfig);
    expect(result.ttlMs).toBe(defaultTtlConfig.minTtlMs);
  });

  it('should clamp age-subtracted result to at least 0 before converting', () => {
    const result = parseCacheHeaders({ 'cache-control': 'max-age=10', age: '100' }, defaultTtlConfig);
    // max-age - age = 10-100 = 0 (clamped), then clamped to minTtlMs
    expect(result.ttlMs).toBe(defaultTtlConfig.minTtlMs);
  });

  it('should extract etag from headers', () => {
    const result = parseCacheHeaders({ etag: '"etag-value"' }, defaultTtlConfig);
    expect(result.etag).toBe('"etag-value"');
  });

  it('should extract lastModified from headers', () => {
    const result = parseCacheHeaders({ 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' }, defaultTtlConfig);
    expect(result.lastModified).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
  });

  it('should handle invalid Expires date gracefully', () => {
    const result = parseCacheHeaders({ expires: 'not-a-date' }, defaultTtlConfig);
    // Invalid date => NaN => uses default TTL
    expect(result.ttlMs).toBe(defaultTtlConfig.defaultTtlMs);
  });

  it('should handle past Expires date', () => {
    const pastDate = new Date(Date.now() - 300_000).toUTCString();
    const result = parseCacheHeaders({ expires: pastDate }, defaultTtlConfig);
    // Negative TTL clamped to 0, then clamped to minTtlMs
    expect(result.ttlMs).toBe(defaultTtlConfig.minTtlMs);
  });
});

// ============================================
// InMemoryCimdCache
// ============================================

describe('InMemoryCimdCache', () => {
  let cache: InMemoryCimdCache;
  const doc = makeDocument();

  beforeEach(() => {
    jest.useFakeTimers();
    cache = new InMemoryCimdCache();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default config values', () => {
      const c = new InMemoryCimdCache();
      expect(c).toBeInstanceOf(InMemoryCimdCache);
    });

    it('should accept custom config', () => {
      const c = new InMemoryCimdCache({
        defaultTtlMs: 5000,
        maxTtlMs: 10000,
        minTtlMs: 1000,
      });
      expect(c).toBeInstanceOf(InMemoryCimdCache);
    });
  });

  describe('set / get', () => {
    it('should round-trip a document', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);

      const result = await cache.get('client-1');
      assertDefined(result);
      expect(result.document).toEqual(doc);
    });

    it('should return undefined for missing entry', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should store etag and lastModified', async () => {
      const headers = makeHeaders({
        'cache-control': 'max-age=3600',
        etag: '"abc"',
        'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
      await cache.set('client-1', doc, headers);

      const result = await cache.get('client-1');
      assertDefined(result);
      expect(result.etag).toBe('"abc"');
      expect(result.lastModified).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('should store cachedAt timestamp', async () => {
      const now = Date.now();
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);

      const result = await cache.get('client-1');
      assertDefined(result);
      expect(result.cachedAt).toBeGreaterThanOrEqual(now);
    });
  });

  describe('get with expired entry', () => {
    it('should return undefined for expired entry', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=60' });
      await cache.set('client-1', doc, headers);

      // Advance past expiration
      jest.advanceTimersByTime(61_000);

      const result = await cache.get('client-1');
      expect(result).toBeUndefined();
    });
  });

  describe('getStale', () => {
    it('should return entry even if expired', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=60' });
      await cache.set('client-1', doc, headers);

      jest.advanceTimersByTime(120_000);

      const result = await cache.getStale('client-1');
      assertDefined(result);
      expect(result.document).toEqual(doc);
    });

    it('should return undefined if never cached', async () => {
      const result = await cache.getStale('never-cached');
      expect(result).toBeUndefined();
    });
  });

  describe('revalidate', () => {
    it('should update expiration for existing entry', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=60' });
      await cache.set('client-1', doc, headers);

      // Advance 50 seconds (still valid but close to expiration)
      jest.advanceTimersByTime(50_000);

      const newHeaders = makeHeaders({ 'cache-control': 'max-age=300' });
      const result = await cache.revalidate('client-1', newHeaders);
      expect(result).toBe(true);

      // Advance another 100 seconds - original would have expired, but revalidated
      jest.advanceTimersByTime(100_000);
      const entry = await cache.get('client-1');
      expect(entry).toBeDefined();
    });

    it('should return false for missing entry', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=300' });
      const result = await cache.revalidate('nonexistent', headers);
      expect(result).toBe(false);
    });

    it('should update etag and lastModified', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=60', etag: '"old"' });
      await cache.set('client-1', doc, headers);

      const newHeaders = makeHeaders({
        'cache-control': 'max-age=60',
        etag: '"new"',
        'last-modified': 'Thu, 02 Jan 2025 00:00:00 GMT',
      });
      await cache.revalidate('client-1', newHeaders);

      const entry = await cache.getStale('client-1');
      assertDefined(entry);
      expect(entry.etag).toBe('"new"');
      expect(entry.lastModified).toBe('Thu, 02 Jan 2025 00:00:00 GMT');
    });
  });

  describe('delete', () => {
    it('should remove an entry', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);

      const result = await cache.delete('client-1');
      expect(result).toBe(true);

      const entry = await cache.get('client-1');
      expect(entry).toBeUndefined();
    });

    it('should return false for non-existent entry', async () => {
      const result = await cache.delete('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getConditionalHeaders', () => {
    it('should return etag as If-None-Match', async () => {
      const headers = makeHeaders({
        'cache-control': 'max-age=3600',
        etag: '"etag-value"',
      });
      await cache.set('client-1', doc, headers);

      const conditional = await cache.getConditionalHeaders('client-1');
      assertDefined(conditional);
      expect(conditional['If-None-Match']).toBe('"etag-value"');
    });

    it('should return lastModified as If-Modified-Since', async () => {
      const headers = makeHeaders({
        'cache-control': 'max-age=3600',
        'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
      await cache.set('client-1', doc, headers);

      const conditional = await cache.getConditionalHeaders('client-1');
      assertDefined(conditional);
      expect(conditional['If-Modified-Since']).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('should return both etag and lastModified', async () => {
      const headers = makeHeaders({
        'cache-control': 'max-age=3600',
        etag: '"etag-123"',
        'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
      await cache.set('client-1', doc, headers);

      const conditional = await cache.getConditionalHeaders('client-1');
      assertDefined(conditional);
      expect(conditional['If-None-Match']).toBe('"etag-123"');
      expect(conditional['If-Modified-Since']).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('should return undefined for non-existent entry', async () => {
      const result = await cache.getConditionalHeaders('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined when entry has no etag or lastModified', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);

      const result = await cache.getConditionalHeaders('client-1');
      expect(result).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);
      await cache.set('client-2', doc, headers);

      await cache.clear();

      expect(await cache.size()).toBe(0);
      expect(await cache.get('client-1')).toBeUndefined();
    });
  });

  describe('size', () => {
    it('should return 0 for empty cache', async () => {
      expect(await cache.size()).toBe(0);
    });

    it('should return correct count', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=3600' });
      await cache.set('client-1', doc, headers);
      await cache.set('client-2', doc, headers);
      expect(await cache.size()).toBe(2);
    });
  });

  describe('cleanup', () => {
    it('should remove very old expired entries (2x maxTtl past expiration)', async () => {
      // Cache uses default config: maxTtlMs = 86400_000 (24h)
      const headers = makeHeaders({ 'cache-control': 'max-age=60' });
      await cache.set('old-client', doc, headers);

      // Advance time past expiration + 2 * maxTtl
      // Entry expires at +60s, cleanup removes if expiresAt + 2*maxTtl < now
      // So we need: now > expiresAt + 2 * 86400000
      jest.advanceTimersByTime(60_000 + 86400_000 * 2 + 1);

      const removed = await cache.cleanup();
      expect(removed).toBe(1);
      expect(await cache.size()).toBe(0);
    });

    it('should not remove recently expired entries', async () => {
      const headers = makeHeaders({ 'cache-control': 'max-age=60' });
      await cache.set('recent-client', doc, headers);

      // Advance just past expiration (but not past 2x maxTtl)
      jest.advanceTimersByTime(120_000);

      const removed = await cache.cleanup();
      expect(removed).toBe(0);
      expect(await cache.size()).toBe(1);
    });

    it('should return 0 for empty cache', async () => {
      const removed = await cache.cleanup();
      expect(removed).toBe(0);
    });
  });
});

// ============================================
// createCimdCache
// ============================================

describe('createCimdCache', () => {
  it('should return InMemoryCimdCache by default', async () => {
    const cache = await createCimdCache();
    expect(cache).toBeInstanceOf(InMemoryCimdCache);
  });

  it('should return InMemoryCimdCache for memory type', async () => {
    const cache = await createCimdCache({ type: 'memory', defaultTtlMs: 5000, maxTtlMs: 10000, minTtlMs: 1000 });
    expect(cache).toBeInstanceOf(InMemoryCimdCache);
  });

  it('should throw when redis type requested without config', async () => {
    await expect(
      createCimdCache({ type: 'redis', defaultTtlMs: 5000, maxTtlMs: 10000, minTtlMs: 1000 }),
    ).rejects.toThrow('Redis configuration is required');
  });
});
