/**
 * CacheRedisProvider on a Redis Cluster, and with a client the app made (#1503).
 */
import CacheRedisProvider from '../providers/cache-redis.provider';

const mockNode = () => ({
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
});
const mockCluster = { ...mockNode(), once: jest.fn() };
const MockCluster = jest.fn((..._args: unknown[]) => mockCluster);
const MockRedis = jest.fn((..._args: unknown[]) => mockNode());

jest.mock('ioredis', () => {
  class Redis {
    static Cluster = class {
      constructor(...args: unknown[]) {
        return MockCluster(...args);
      }
    };
    constructor(...args: unknown[]) {
      return MockRedis(...args);
    }
  }
  return { __esModule: true, default: Redis };
});

describe('CacheRedisProvider on a cluster', () => {
  beforeEach(() => {
    MockCluster.mockClear();
    MockRedis.mockClear();
  });

  it('opens an ioredis Cluster for config.cluster, with the TLS object and keyPrefix it was given', () => {
    new CacheRedisProvider({
      type: 'redis',
      config: {
        host: 'cfg.example',
        port: 6379,
        password: 'token',
        tls: { servername: 'cfg.example' },
        keyPrefix: 'billing:',
        cluster: true,
      },
    });

    expect(MockRedis).not.toHaveBeenCalled();
    expect(MockCluster).toHaveBeenCalledWith(
      [{ host: 'cfg.example', port: 6379 }],
      expect.objectContaining({
        keyPrefix: 'billing:',
        redisOptions: expect.objectContaining({ password: 'token', tls: { servername: 'cfg.example' } }),
      }),
    );
  });

  it('opens a single node exactly as before without cluster', () => {
    new CacheRedisProvider({
      type: 'redis',
      config: { host: 'cache', port: 6380, tls: { servername: 'cache' }, keyPrefix: 'app:' },
    });

    expect(MockRedis).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'cache',
        port: 6380,
        tls: { servername: 'cache' },
        keyPrefix: 'app:',
        lazyConnect: false,
        maxRetriesPerRequest: 3,
      }),
    );
  });
});

describe("CacheRedisProvider with the app's own client", () => {
  it('runs commands on it and leaves it open on close()', async () => {
    const client = {
      status: 'ready',
      isCluster: false,
      call: jest.fn(),
      sendCommand: jest.fn(),
      duplicate: jest.fn(),
      get: jest.fn().mockResolvedValue('"v"'),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      quit: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
    };
    const provider = new CacheRedisProvider({ type: 'redis-client', client: client as never });

    await expect(provider.getValue('k')).resolves.toBe('v');
    await provider.close();

    expect(client.get).toHaveBeenCalledWith('k');
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('takes a node-redis client through the adapter', async () => {
    const nodeRedis = {
      isOpen: true,
      connect: jest.fn(),
      duplicate: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      sendCommand: jest.fn().mockResolvedValue('OK'),
    };
    const provider = new CacheRedisProvider({ type: 'redis-client', client: nodeRedis as never });

    await provider.setValue('k', { a: 1 }, 60);
    await provider.close();

    expect(nodeRedis.sendCommand).toHaveBeenCalledWith(['SET', 'k', '{"a":1}', 'EX', '60']);
    expect(nodeRedis.close).not.toHaveBeenCalled();
  });
});
