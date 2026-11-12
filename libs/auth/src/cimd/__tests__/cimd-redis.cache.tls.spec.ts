import { RedisCimdCache } from '../cimd-redis.cache';
import type { CimdCacheConfig } from '../cimd.types';

/** A cache for a `cache.redis` block, with the TTL defaults the schema would add. */
function createCache(redis: Partial<NonNullable<CimdCacheConfig['redis']>>): RedisCimdCache {
  return new RedisCimdCache({ redis } as CimdCacheConfig);
}

/** The ioredis options the cache's storage adapter resolved for its url. */
function connectionOptions(cache: RedisCimdCache): Record<string, unknown> | undefined {
  return (cache as unknown as { redis: { urlOptions?: Record<string, unknown> } }).redis.urlOptions;
}

describe('RedisCimdCache with a url and tls', () => {
  it('connects over TLS when tls is set beside a redis:// url', () => {
    const cache = createCache({ url: 'redis://cache.internal:6379', tls: true });

    expect(connectionOptions(cache)).toMatchObject({ host: 'cache.internal', port: 6379, tls: {} });
  });

  it('refuses tls: false beside a rediss:// url instead of picking one', () => {
    expect(() => createCache({ url: 'rediss://cache.internal:6379', tls: false })).toThrow('contradicts redis.url');
  });
});
