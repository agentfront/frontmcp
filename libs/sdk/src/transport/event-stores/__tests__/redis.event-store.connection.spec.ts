import { RedisEventStore } from '../redis.event-store';

const constructed: Array<Record<string, unknown>> = [];

jest.mock('ioredis', () =>
  jest.fn().mockImplementation((options: Record<string, unknown>) => {
    constructed.push(options);
    return {
      on: jest.fn(),
      connect: jest.fn(async () => undefined),
      xadd: jest.fn(async () => '1700000000000-0'),
      expire: jest.fn(async () => 1),
    };
  }),
);

const message = { jsonrpc: '2.0', method: 'notifications/message', params: {} } as never;

describe('the Redis connection of RedisEventStore', () => {
  beforeEach(() => {
    constructed.length = 0;
  });

  it('connects where a url-only redis option says, with its password, database and TLS', async () => {
    const store = new RedisEventStore({ redis: { url: 'rediss://:secret@cache.example:6380/2' } });

    await store.storeEvent('stream-1', message);

    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ host: 'cache.example', port: 6380, password: 'secret', db: 2, tls: {} });
  });

  it('connects to the given host as before', async () => {
    const store = new RedisEventStore({ redis: { host: 'cache.internal', password: 'secret' } });

    await store.storeEvent('stream-1', message);

    expect(constructed[0]).toMatchObject({ host: 'cache.internal', port: 6379, password: 'secret', db: 0 });
    expect(constructed[0]['tls']).toBeUndefined();
  });

  it('refuses a redis option it cannot use before opening any connection', async () => {
    const store = new RedisEventStore({ redis: { url: 'http://cache.example' } });

    await expect(store.storeEvent('stream-1', message)).rejects.toThrow(/redis option cannot be used/);
    expect(constructed).toHaveLength(0);
  });
});
