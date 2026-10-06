import { CimdService } from '../cimd.service';

/**
 * CimdService keeps documents in the cache `cache.type` selects, created through the
 * `createCimdCache` factory: `'redis'` is a Redis cache (it used to be in memory whatever the type).
 */
const mockRedisConnect = jest.fn().mockResolvedValue(undefined);
const mockRedisGet = jest.fn().mockResolvedValue(null);
const mockRedisKeys = jest.fn().mockResolvedValue(['cimd:a', 'cimd:b']);
const mockRedisAdapter = jest.fn().mockImplementation(() => ({
  connect: mockRedisConnect,
  get: mockRedisGet,
  keys: mockRedisKeys,
}));

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  RedisStorageAdapter: mockRedisAdapter,
}));

describe('CimdService cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a Redis cache with cache.type redis, connected on initialize', async () => {
    const service = new CimdService(undefined, {
      cache: { type: 'redis', redis: { url: 'redis://cache.example.com:6379', keyPrefix: 'cimd:' } },
    });

    await service.initialize();

    expect(mockRedisAdapter).toHaveBeenCalledWith({ url: 'redis://cache.example.com:6379' });
    expect(mockRedisConnect).toHaveBeenCalledTimes(1);
    expect(await service.getCacheStats()).toEqual({ size: 2 });
    expect(mockRedisConnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the in-memory cache by default', async () => {
    const service = new CimdService();

    await service.initialize();

    expect(mockRedisAdapter).not.toHaveBeenCalled();
    expect(await service.getCacheStats()).toEqual({ size: 0 });
  });

  it('fails initialize when cache.type is redis without a redis connection, and retries on the next use', async () => {
    const service = new CimdService(undefined, { cache: { type: 'redis' } });

    await expect(service.initialize()).rejects.toThrow('Redis configuration is required');
    await expect(service.getCacheStats()).rejects.toThrow('Redis configuration is required');
  });
});
