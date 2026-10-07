import { StorageConfigError } from '@frontmcp/utils';

import { createJobDefinitionStore } from '../job-definition-store.factory';
import { createJobStateStore } from '../job-state-store.factory';

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

  it('connects the state store with every connection field of the redis option', () => {
    const { type } = createJobStateStore({ redis: { provider: 'redis', ...connection } });

    expect(type).toBe('redis');
    expect(createRedisClient).toHaveBeenCalledWith(expect.objectContaining(connection));
  });

  it('connects the definition store with every connection field of the redis option', () => {
    const { type } = createJobDefinitionStore({ redis: connection });

    expect(type).toBe('redis');
    expect(createRedisClient).toHaveBeenCalledWith(expect.objectContaining(connection));
  });

  it('passes a url on with the fields beside it, for them to fill in what it leaves out', () => {
    createJobStateStore({ redis: { provider: 'redis', url: 'redis://cache.internal:6380', password: 'secret' } });

    expect(createRedisClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'redis://cache.internal:6380', password: 'secret' }),
    );
  });

  it('stops on a url a field contradicts instead of falling back to memory', () => {
    createRedisClient.mockImplementation(() => {
      throw new StorageConfigError('redis', 'redis port contradicts redis.url.');
    });
    const contradicting = { url: 'redis://cache.internal:6380', port: 6379 };

    expect(() => createJobStateStore({ redis: { provider: 'redis', ...contradicting } })).toThrow(StorageConfigError);
    expect(() => createJobDefinitionStore({ redis: contradicting })).toThrow(StorageConfigError);
  });

  it('still falls back to memory when the client cannot be created', () => {
    createRedisClient.mockImplementation(() => {
      throw new Error('ioredis is required for Redis storage adapter');
    });

    expect(createJobStateStore({ redis: { provider: 'redis', ...connection } }).type).toBe('memory');
    expect(createJobDefinitionStore({ redis: connection }).type).toBe('memory');
  });
});
