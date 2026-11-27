/**
 * RedisStorageAdapter on a Redis Cluster, with mocked clients (#1503): multi-key work is split per
 * key, SCAN runs on every master, and a cluster config opens an ioredis Cluster.
 */
import { StorageConnectionError } from '../../errors';
import { RedisStorageAdapter } from '../redis';

function mockNode(keys: string[] = []) {
  return {
    scan: jest.fn().mockResolvedValue(['0', keys]),
  };
}

function mockClusterClient(masters = [mockNode(['p:a']), mockNode(['p:b'])]) {
  return {
    status: 'ready',
    isCluster: true,
    call: jest.fn(),
    sendCommand: jest.fn(),
    nodes: jest.fn(() => masters),
    duplicate: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(async (key: string) => `v:${key}`),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    mget: jest.fn(),
    pipeline: jest.fn(),
    scan: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    removeListener: jest.fn(),
  };
}

const mockClusterInstance = mockClusterClient();
const MockCluster = jest.fn((..._args: unknown[]) => mockClusterInstance);

jest.mock('ioredis', () => {
  class Redis {
    static Cluster = class {
      constructor(...args: unknown[]) {
        return MockCluster(...args);
      }
    };
  }
  return { __esModule: true, default: Redis };
});

describe('RedisStorageAdapter with a cluster client', () => {
  let client: ReturnType<typeof mockClusterClient>;
  let adapter: RedisStorageAdapter;

  beforeEach(async () => {
    client = mockClusterClient();
    adapter = new RedisStorageAdapter({ client, keyPrefix: 'p:' });
    await adapter.connect();
  });

  it('reads keys of different slots with one GET each, in order (no MGET)', async () => {
    await expect(adapter.mget(['a', 'b'])).resolves.toEqual(['v:p:a', 'v:p:b']);
    expect(client.mget).not.toHaveBeenCalled();
  });

  it('writes keys of different slots with one SET each (no pipeline)', async () => {
    await adapter.mset([
      { key: 'a', value: '1', options: { ttlSeconds: 5, ifNotExists: true } },
      { key: 'b', value: '2', options: { ifExists: true } },
      { key: 'c', value: '3' },
    ]);
    expect(client.pipeline).not.toHaveBeenCalled();
    expect(client.set.mock.calls).toEqual([
      ['p:a', '1', 'EX', 5, 'NX'],
      ['p:b', '2', 'XX'],
      ['p:c', '3'],
    ]);
  });

  it('deletes keys of different slots with one DEL each', async () => {
    await expect(adapter.mdelete(['a', 'b'])).resolves.toBe(2);
    expect(client.del.mock.calls).toEqual([['p:a'], ['p:b']]);
  });

  it('scans every master for keys() and count()', async () => {
    await expect(adapter.keys('*')).resolves.toEqual(['a', 'b']);
    await expect(adapter.count('*')).resolves.toBe(2);
    expect(client.scan).not.toHaveBeenCalled();
  });

  it('never closes the client it was given', async () => {
    await adapter.disconnect();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});

describe('RedisStorageAdapter with a FrontMcpRedisClient that has no pipeline', () => {
  it('writes the entries one by one', async () => {
    const client = { ...mockClusterClient(), isCluster: false, pipeline: undefined };
    const adapter = new RedisStorageAdapter({ client });
    await adapter.connect();
    await adapter.mset([{ key: 'a', value: '1' }]);
    expect(client.set).toHaveBeenCalledWith('a', '1');
  });
});

describe('RedisStorageAdapter with a cluster config', () => {
  beforeEach(() => {
    MockCluster.mockClear();
  });

  it('opens an ioredis Cluster from the host with cluster: true, and closes it on disconnect', async () => {
    const adapter = new RedisStorageAdapter({ config: { host: 'cfg', port: 7000, tls: true, cluster: true } });
    await adapter.connect();
    expect(MockCluster).toHaveBeenCalledWith(
      [{ host: 'cfg', port: 7000 }],
      expect.objectContaining({ redisOptions: expect.objectContaining({ tls: {} }) }),
    );
    await adapter.disconnect();
    expect(mockClusterInstance.quit).toHaveBeenCalled();
  });

  it('opens one from a url with config.cluster', async () => {
    const adapter = new RedisStorageAdapter({ url: 'rediss://cfg:7001', config: { cluster: true } });
    await adapter.connect();
    expect(MockCluster).toHaveBeenCalledWith([{ host: 'cfg', port: 7001 }], expect.anything());
  });

  it('opens one from cluster.nodes alone', async () => {
    const adapter = new RedisStorageAdapter({ config: { cluster: { nodes: ['10.0.0.1:7000'] } } });
    await adapter.connect();
    expect(MockCluster).toHaveBeenCalledWith([{ host: '10.0.0.1', port: 7000 }], expect.anything());
  });

  it('still needs a host (or seed nodes) without a url', async () => {
    const adapter = new RedisStorageAdapter({ config: { cluster: true } as never });
    await expect(adapter.connect()).rejects.toThrow(StorageConnectionError);
    expect(MockCluster).not.toHaveBeenCalled();
  });

  it('opens the subscriber as a second cluster connection', async () => {
    const adapter = new RedisStorageAdapter({ config: { host: 'cfg', cluster: true } });
    await adapter.connect();
    mockClusterInstance.duplicate.mockClear();
    const subscriber = { ...mockClusterClient(), subscribe: jest.fn(), unsubscribe: jest.fn() };
    MockCluster.mockReturnValueOnce(subscriber as never);
    await adapter.subscribe('ch', () => undefined);
    expect(MockCluster).toHaveBeenCalledTimes(2);
    expect(subscriber.subscribe).toHaveBeenCalledWith('ch');
  });
});
