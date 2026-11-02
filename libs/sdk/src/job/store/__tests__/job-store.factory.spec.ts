import { StorageConfigError } from '@frontmcp/utils';

import { createJobDefinitionStore } from '../job-definition-store.factory';
import { createJobStateStore } from '../job-state-store.factory';
import { RedisJobStateStore, type RedisStateStoreLike } from '../redis-job-state.store';

const createRedisClient = jest.fn((_options: Record<string, unknown>): unknown => ({}));

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  createRedisClient: (options: Record<string, unknown>) => createRedisClient(options),
}));

const connection = { host: 'cache.internal', port: 6380, password: 'secret', db: 3, tls: true };

describe('job store factories with Redis', () => {
  beforeEach(() => {
    createRedisClient.mockReset();
    createRedisClient.mockReturnValue({});
  });

  it('connects the state store with every connection field of the redis option', async () => {
    const { type } = await createJobStateStore({ redis: { provider: 'redis', ...connection } });

    expect(type).toBe('redis');
    expect(createRedisClient).toHaveBeenCalledWith(expect.objectContaining(connection));
  });

  it('connects the definition store with every connection field of the redis option', async () => {
    const { type } = await createJobDefinitionStore({ redis: connection });

    expect(type).toBe('redis');
    expect(createRedisClient).toHaveBeenCalledWith(expect.objectContaining(connection));
  });

  it('passes a url on with the fields beside it, for them to fill in what it leaves out', async () => {
    await createJobStateStore({ redis: { provider: 'redis', url: 'redis://cache.internal:6380', password: 'secret' } });

    expect(createRedisClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'redis://cache.internal:6380', password: 'secret' }),
    );
  });

  it('stops on a url a field contradicts instead of falling back to memory', async () => {
    createRedisClient.mockImplementation(() => {
      throw new StorageConfigError('redis', 'redis port contradicts redis.url.');
    });
    const contradicting = { url: 'redis://cache.internal:6380', port: 6379 };

    await expect(createJobStateStore({ redis: { provider: 'redis', ...contradicting } })).rejects.toThrow(
      StorageConfigError,
    );
    await expect(createJobDefinitionStore({ redis: contradicting })).rejects.toThrow(StorageConfigError);
  });

  it('closes the client the state store connected when the store is disposed', async () => {
    const quit = jest.fn(async () => 'OK');
    createRedisClient.mockReturnValue({ quit });
    const { store } = await createJobStateStore({ redis: { provider: 'redis', ...connection } });

    await store.dispose();
    await store.dispose();

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('still falls back to memory when the client cannot be created', async () => {
    createRedisClient.mockImplementation(() => {
      throw new Error('ioredis is required for Redis storage adapter');
    });

    expect((await createJobStateStore({ redis: { provider: 'redis', ...connection } })).type).toBe('memory');
    expect((await createJobDefinitionStore({ redis: connection })).type).toBe('memory');
  });
});

describe('RedisJobStateStore', () => {
  it('expires the index sets of a run with the run, so they do not outlive it', async () => {
    const expire = jest.fn(async () => 1);
    const client = {
      set: jest.fn(async () => 'OK'),
      sadd: jest.fn(async () => 1),
      expire,
    };
    const store = new RedisJobStateStore(client as unknown as RedisStateStoreLike, undefined, 'p:', 60);

    await store.createRun({
      runId: 'r1',
      jobId: 'report',
      jobName: 'report',
      sessionId: 's1',
      state: 'pending',
      input: {},
      startedAt: 1,
      attempt: 1,
      maxAttempts: 1,
      logs: [],
      background: true,
    });

    expect(expire).toHaveBeenCalledWith('p:idx:jobId:report', 60);
    expect(expire).toHaveBeenCalledWith('p:idx:sessionId:s1', 60);
  });
});
