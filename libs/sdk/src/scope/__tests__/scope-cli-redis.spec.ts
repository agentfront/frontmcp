/**
 * CLI mode keeps its tasks in the top-level redis whichever form it takes (#1035): a `url` reached the task store in
 * server mode only, so the generated CLI kept them in memory, or in the Redis of `REDIS_URL`.
 */
import 'reflect-metadata';

import { createStorage, type StorageConfig } from '@frontmcp/utils';

import { App } from '../../common/decorators/app.decorator';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return {
    ...actual,
    createStorage: jest.fn(async (config: StorageConfig = {}) => actual.createMemoryStorage({ prefix: config.prefix })),
  };
});

@App({ id: 'cli-redis', name: 'cli-redis' })
class CliRedisApp {}

const started: FrontMcpInstance[] = [];

async function startCli(redis: unknown): Promise<{ taskBackendType?: string }> {
  const instance = await FrontMcpInstance.createForCli({
    info: { name: 'cli-redis', version: '0.0.0' },
    apps: [CliRedisApp],
    redis,
  } as never);
  started.push(instance);
  return instance.getScopes()[0] as unknown as { taskBackendType?: string };
}

describe('the top-level redis in CLI mode', () => {
  afterEach(async () => {
    await Promise.all(started.splice(0).map((instance) => instance.shutdown()));
    jest.clearAllMocks();
  });

  it('keeps the tasks in the Redis a url names, with its password, database and TLS', async () => {
    const scope = await startCli({ url: 'rediss://:secret@cache.internal:6380/3' });

    expect(scope.taskBackendType).toBe('redis');
    expect(createStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'redis',
        redis: { config: { host: 'cache.internal', port: 6380, password: 'secret', db: 3, tls: true } },
        prefix: 'mcp:task:',
      }),
    );
  });

  it('fails startup on an unusable redis, with the message of the server, before any store opens', async () => {
    await expect(startCli({ url: 'http://cache.internal:6379' })).rejects.toThrow(
      'redis.url must use the redis:// or rediss:// scheme',
    );
    expect(createStorage).not.toHaveBeenCalled();
  });
});
