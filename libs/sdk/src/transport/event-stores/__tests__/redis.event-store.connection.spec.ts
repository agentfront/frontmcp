import { REQUIRED_REDIS_CLIENT_METHODS } from '@frontmcp/utils';

import { RedisEventStore } from '../redis.event-store';

const constructed: Array<Record<string, unknown>> = [];

function fakeClient() {
  return {
    connect: jest.fn(async () => undefined),
    xadd: jest.fn(async () => '1700000000000-0'),
    xrange: jest.fn(async () => []),
    expire: jest.fn(async () => 1),
    quit: jest.fn(async () => 'OK'),
  };
}

let lastClient = fakeClient();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  createRedisConnection: (options: Record<string, unknown>) => {
    constructed.push(options);
    lastClient = fakeClient();
    const { client } = options as { client?: unknown };
    return client ? { client, owned: false, kind: 'ioredis' } : { client: lastClient, owned: true, kind: 'ioredis' };
  },
}));

const message = { jsonrpc: '2.0', method: 'notifications/message', params: {} } as never;

describe('the Redis connection of RedisEventStore', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('connects where a url-only redis option says, with its password, database and TLS', async () => {
    const store = new RedisEventStore({ redis: { url: 'rediss://:secret@cache.example:6380/2' } });

    await store.storeEvent('stream-1', message);

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ host: 'cache.example', port: 6380, password: 'secret', db: 2, tls: true });
    expect(lastClient.connect).toHaveBeenCalledTimes(1);
  });

  it('connects to the given host as before, lazily and without a ready check', async () => {
    const store = new RedisEventStore({ redis: { host: 'cache.internal', password: 'secret' } });

    await store.storeEvent('stream-1', message);

    expect(constructed[0]).toMatchObject({
      host: 'cache.internal',
      port: 6379,
      password: 'secret',
      db: 0,
      tls: false,
      label: 'RedisEventStore',
      ioredisOptions: { lazyConnect: true, enableReadyCheck: false },
    });
    expect(constructed[0]).not.toHaveProperty('cluster');
  });

  it('opens a cluster for cluster: true (#1503)', async () => {
    const store = new RedisEventStore({ redis: { host: 'cfg.example', tls: true, cluster: true } });

    await store.storeEvent('stream-1', message);

    expect(constructed[0]).toMatchObject({ host: 'cfg.example', tls: true, cluster: true });
  });

  it("uses the app's own client without connecting or closing it (#1503)", async () => {
    const client = {
      ...Object.fromEntries(REQUIRED_REDIS_CLIENT_METHODS.map((name) => [name, jest.fn()])),
      ...fakeClient(),
    };
    const store = new RedisEventStore({ redis: { client } });

    await store.storeEvent('stream-1', message);

    expect(constructed[0]).toEqual(expect.objectContaining({ client }));
    expect(client.xadd).toHaveBeenCalled();
    expect(client.connect).not.toHaveBeenCalled();
  });

  it('refuses a redis option it cannot use before opening any connection', async () => {
    const store = new RedisEventStore({ redis: { url: 'http://cache.example' } });

    await expect(store.storeEvent('stream-1', message)).rejects.toThrow(/redis option cannot be used/);
    expect(constructed).toHaveLength(0);
  });
});
