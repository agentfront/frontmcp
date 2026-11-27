/**
 * createRedisConnection: each config shape, each client kind, and who owns the client (#1503).
 */
import { StorageConfigError } from '../../errors';
import { isBorrowedRedisClient } from '../borrow';
import { adoptRedisClient, createRedisConnection, wantsRedisCluster } from '../connection';
import { NodeRedisClientAdapter } from '../node-redis-adapter';

function fakeEmitter() {
  return { on: jest.fn(), removeListener: jest.fn() };
}

const MockRedis = jest.fn((..._args: unknown[]) => fakeEmitter());
const MockCluster = jest.fn((..._args: unknown[]) => ({ ...fakeEmitter(), once: jest.fn() }));

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

/** An ioredis-shaped client, as a second copy of ioredis would make it. */
function ioredisShaped(isCluster: boolean) {
  return {
    status: 'ready',
    isCluster,
    call: jest.fn(),
    sendCommand: jest.fn(),
    duplicate: jest.fn(() => ioredisShaped(isCluster)),
    nodes: jest.fn(() => []),
    get: jest.fn().mockResolvedValue('v'),
    set: jest.fn(),
    del: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  };
}

function nodeRedisShaped(cluster: boolean) {
  return {
    isOpen: true,
    sendCommand: jest.fn(),
    connect: jest.fn(),
    duplicate: jest.fn(),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn(),
    ...(cluster ? { masters: [], nodeClient: jest.fn() } : {}),
  };
}

describe('createRedisConnection', () => {
  beforeEach(() => {
    MockRedis.mockClear();
    MockCluster.mockClear();
  });

  describe('a single node (unchanged)', () => {
    it('opens an ioredis Redis from host/port with the options FrontMCP always used', () => {
      const connection = createRedisConnection({ host: 'cache', port: 6380, password: 'pw', db: 2, tls: true });
      expect(MockRedis).toHaveBeenCalledWith({
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        host: 'cache',
        port: 6380,
        password: 'pw',
        db: 2,
        tls: {},
      });
      expect(MockCluster).not.toHaveBeenCalled();
      expect(connection).toMatchObject({ owned: true, kind: 'ioredis', isCluster: false });
    });

    it('defaults host, port and db as createRedisClient did', () => {
      createRedisConnection({});
      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'localhost', port: 6379, db: 0, tls: undefined }),
      );
    });

    it('reads a redis:// url, with the fields beside it filling in', () => {
      createRedisConnection({ url: 'redis://cache:6390/1', password: 'pw' });
      expect(MockRedis).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'cache', port: 6390, db: 1, password: 'pw', lazyConnect: false }),
      );
    });

    it('hands ioredis a url it reads by itself as is', () => {
      createRedisConnection({ url: '/tmp/redis.sock' });
      expect(MockRedis).toHaveBeenCalledWith('/tmp/redis.sock', { lazyConnect: false, maxRetriesPerRequest: 3 });
    });

    it('applies ioredisOptions over the defaults', () => {
      createRedisConnection({ host: 'cache', ioredisOptions: { lazyConnect: true, enableReadyCheck: false } });
      expect(MockRedis).toHaveBeenCalledWith(expect.objectContaining({ lazyConnect: true, enableReadyCheck: false }));
    });

    it('attaches the rate-limited error listener unless told not to', () => {
      const listened = createRedisConnection({ host: 'cache' }).client as unknown as { on: jest.Mock };
      expect(listened.on).toHaveBeenCalledWith('error', expect.any(Function));
      const quiet = createRedisConnection({ host: 'cache', noErrorListener: true }).client as unknown as {
        on: jest.Mock;
      };
      expect(quiet.on).not.toHaveBeenCalled();
    });

    it('refuses a field that contradicts the url', () => {
      expect(() => createRedisConnection({ url: 'redis://cache:6379', port: 7000 })).toThrow(StorageConfigError);
    });
  });

  describe('cluster: true on host/port/url', () => {
    it('opens an ioredis Cluster from the endpoint, with TLS and the password on every node', () => {
      const connection = createRedisConnection({
        host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com',
        port: 6379,
        password: 'token',
        tls: true,
        db: 0,
        cluster: true,
      });
      expect(MockRedis).not.toHaveBeenCalled();
      const [nodes, options] = MockCluster.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(nodes).toEqual([{ host: 'my-cluster.xxxxxx.clustercfg.use2.cache.amazonaws.com', port: 6379 }]);
      expect(options).toMatchObject({
        lazyConnect: false,
        redisOptions: { maxRetriesPerRequest: 3, password: 'token', tls: {} },
      });
      expect(connection).toMatchObject({ owned: true, kind: 'ioredis-cluster', isCluster: true });
    });

    it('keeps the hostname for TLS (dnsLookup returns the address it is given)', () => {
      createRedisConnection({ host: 'cfg.example', cluster: true });
      const options = MockCluster.mock.calls[0][1] as {
        dnsLookup: (a: string, cb: (e: null, a: string) => void) => void;
      };
      const callback = jest.fn();
      options.dnsLookup('cfg.example', callback);
      expect(callback).toHaveBeenCalledWith(null, 'cfg.example');
    });

    it('reads the seed node, password and TLS from a rediss:// url', () => {
      createRedisConnection({ url: 'rediss://:secret@cfg.example:6390', cluster: true });
      const [nodes, options] = MockCluster.mock.calls[0] as [unknown, { redisOptions: Record<string, unknown> }];
      expect(nodes).toEqual([{ host: 'cfg.example', port: 6390 }]);
      expect(options.redisOptions).toMatchObject({ password: 'secret', tls: {} });
    });

    it('gives up on a cluster it never reached, but reconnects to one that was up', () => {
      const client = createRedisConnection({ host: 'cfg.example', cluster: true }).client as unknown as {
        once: jest.Mock;
      };
      const { clusterRetryStrategy } = MockCluster.mock.calls[0][1] as {
        clusterRetryStrategy: (times: number) => number | null;
      };
      expect(clusterRetryStrategy(1)).toBe(102);
      expect(clusterRetryStrategy(4)).toBeNull();
      const [event, onReady] = client.once.mock.calls[0] as [string, () => void];
      expect(event).toBe('ready');
      onReady();
      expect(clusterRetryStrategy(50)).toBe(200);
      expect(clusterRetryStrategy(5000)).toBe(2000);
    });

    it('splits ioredisOptions between the cluster and its nodes', () => {
      createRedisConnection({
        host: 'cfg',
        cluster: true,
        ioredisOptions: { lazyConnect: true, enableReadyCheck: false, connectTimeout: 5 },
      });
      const options = MockCluster.mock.calls[0][1] as Record<string, unknown> & {
        redisOptions: Record<string, unknown>;
      };
      expect(options).toMatchObject({ lazyConnect: true, enableReadyCheck: false });
      expect(options.redisOptions).toMatchObject({ connectTimeout: 5 });
      expect(options.redisOptions).not.toHaveProperty('lazyConnect');
    });

    it('refuses a database other than 0', () => {
      expect(() => createRedisConnection({ host: 'cfg', db: 1, cluster: true })).toThrow(/database 0 only/);
      expect(() => createRedisConnection({ url: 'redis://cfg:6379/3', cluster: true })).toThrow(/database 0 only/);
    });

    it('refuses a url ioredis would have to read by itself', () => {
      expect(() => createRedisConnection({ url: '/tmp/redis.sock', cluster: true })).toThrow(StorageConfigError);
    });

    it('needs a node to start from', () => {
      expect(() => createRedisConnection({ cluster: true })).toThrow(/needs a node to start from/);
    });
  });

  describe('cluster: { nodes, options }', () => {
    it('takes seed nodes as objects, host:port, [ipv6]:port and urls', () => {
      createRedisConnection({
        password: 'pw',
        cluster: {
          nodes: [
            { host: '10.0.0.1', port: 7000 },
            '10.0.0.2:7001',
            '[::1]:7002',
            'redis://10.0.0.3:7003',
            'bare-host',
          ],
        },
      });
      expect(MockCluster.mock.calls[0][0]).toEqual([
        { host: '10.0.0.1', port: 7000 },
        { host: '10.0.0.2', port: 7001 },
        { host: '::1', port: 7002 },
        { host: '10.0.0.3', port: 7003 },
        { host: 'bare-host', port: 6379 },
      ]);
      expect(MockCluster.mock.calls[0][1]).toMatchObject({ redisOptions: { password: 'pw' } });
    });

    it('takes credentials and TLS from a node url when the config has none', () => {
      createRedisConnection({ cluster: { nodes: ['rediss://user:pw@10.0.0.1:7000'] } });
      expect(MockCluster.mock.calls[0][1]).toMatchObject({
        redisOptions: { password: 'pw', username: 'user', tls: {} },
      });
    });

    it('applies options and redisOptions over the defaults', () => {
      const dnsLookup = jest.fn();
      createRedisConnection({
        host: 'cfg',
        tls: true,
        cluster: { options: { scaleReads: 'slave', dnsLookup, redisOptions: { tls: { servername: 'cfg' } } } },
      });
      expect(MockCluster.mock.calls[0][1]).toMatchObject({
        scaleReads: 'slave',
        dnsLookup,
        redisOptions: { maxRetriesPerRequest: 3, tls: { servername: 'cfg' } },
      });
    });

    it('refuses a node it cannot read', () => {
      expect(() => createRedisConnection({ cluster: { nodes: [{ host: '' }] } })).toThrow(/each node needs a host/);
      expect(() => createRedisConnection({ cluster: { nodes: ['redis://'] } })).toThrow(/not a usable Redis URL/);
      expect(() => createRedisConnection({ cluster: { nodes: [':'] } })).toThrow(/not host:port/);
    });

    it('falls back to the host when nodes is empty', () => {
      createRedisConnection({ host: 'cfg', port: 7000, cluster: { nodes: [] } });
      expect(MockCluster.mock.calls[0][0]).toEqual([{ host: 'cfg', port: 7000 }]);
    });
  });

  describe('client', () => {
    it('adopts an ioredis Redis as it is, behind a guard that never closes it', async () => {
      const client = ioredisShaped(false);
      const connection = createRedisConnection({ client });
      expect(connection).toMatchObject({ owned: false, kind: 'ioredis', isCluster: false });
      expect(isBorrowedRedisClient(connection.client)).toBe(true);
      await expect(connection.client.get('k')).resolves.toBe('v');
      expect(client.get).toHaveBeenCalledWith('k');
      await connection.client.quit();
      connection.client.disconnect();
      expect(client.quit).not.toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();
      // A copy is real, and belongs to whoever asked for it
      const copy = connection.client.duplicate() as unknown as ReturnType<typeof ioredisShaped>;
      expect(isBorrowedRedisClient(copy)).toBe(false);
      await copy.quit();
      expect(copy.quit).toHaveBeenCalled();
      expect(MockRedis).not.toHaveBeenCalled();
    });

    it('adopts an ioredis Cluster', () => {
      expect(createRedisConnection({ client: ioredisShaped(true) })).toMatchObject({
        kind: 'ioredis-cluster',
        isCluster: true,
        owned: false,
      });
    });

    it('wraps a node-redis client and cluster in the adapter', () => {
      const single = createRedisConnection({ client: nodeRedisShaped(false) });
      expect(single.client).toBeInstanceOf(NodeRedisClientAdapter);
      expect(single).toMatchObject({ kind: 'node-redis', isCluster: false, owned: false });
      const cluster = createRedisConnection({ client: nodeRedisShaped(true) });
      expect(cluster).toMatchObject({ kind: 'node-redis-cluster', isCluster: true, owned: false });
      expect(cluster.client.isCluster).toBe(true);
    });

    it('takes any object with get, set and del as a FrontMcpRedisClient', () => {
      const custom = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
      expect(createRedisConnection({ client: custom })).toMatchObject({ kind: 'custom', owned: false });
    });

    it('refuses something that is not a Redis client', () => {
      expect(() => createRedisConnection({ client: { ping: jest.fn() } })).toThrow(
        /not a Redis client FrontMCP can use/,
      );
      expect(() => createRedisConnection({ client: 'redis://cache' as unknown as object })).toThrow(StorageConfigError);
    });

    it('refuses connection settings beside a client', () => {
      expect(() => createRedisConnection({ client: ioredisShaped(false), host: 'cache', cluster: true })).toThrow(
        /drop host, cluster beside it/,
      );
      // `cluster: false` says nothing
      expect(() => createRedisConnection({ client: ioredisShaped(false), cluster: false })).not.toThrow();
    });
  });
});

describe('adoptRedisClient', () => {
  it('uses an unrecognized object as given unless strict', () => {
    const partial = { ping: jest.fn() };
    expect(adoptRedisClient(partial).kind).toBe('custom');
    expect(() => adoptRedisClient(partial, { strict: true })).toThrow(StorageConfigError);
  });
});

describe('wantsRedisCluster', () => {
  it.each([
    [true, true],
    [{}, true],
    [{ nodes: [] }, true],
    [false, false],
    [undefined, false],
  ])('%p -> %p', (cluster, expected) => {
    expect(wantsRedisCluster(cluster as never)).toBe(expected);
  });
});
