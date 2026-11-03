/**
 * A build boots the server only to read it, and opens none of its stores (#1041). There a CachePlugin store is not
 * built: a `global-store` needs no top-level `redis`, which the build leaves out, and a `type: 'redis'` cache opens no
 * client. A server that starts builds them as before.
 */
import 'reflect-metadata';

import Redis from 'ioredis';

import { App, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import CachePlugin from '../cache.plugin';
import type { CachePluginOptions } from '../cache.types';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn(), quit: jest.fn() })));

const redisClient = Redis as unknown as jest.Mock;
const redis = { host: '127.0.0.1', port: 6379 };

function serverWith(cache: CachePluginOptions, options: Record<string, unknown> = {}) {
  @App({ id: 'cached', name: 'Cached', plugins: [CachePlugin.init(cache)] })
  class CachedApp {}

  return {
    info: { name: 'cache-build-stores', version: '1.0.0' },
    apps: [CachedApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false },
    ...options,
  };
}

afterEach(() => jest.clearAllMocks());

describe("CachePlugin in a build's boot", () => {
  it.each([
    ["type: 'global-store'", { type: 'global-store' }],
    ["type: 'redis'", { type: 'redis', config: redis }],
  ] as const)('reads a server whose cache is on %s without building it', async (_option, cache) => {
    const instance = await FrontMcpInstance.createForManifest(serverWith(cache, { redis }));
    await instance.shutdown();

    expect(redisClient).not.toHaveBeenCalled();
  });
});

describe('CachePlugin on a server that starts', () => {
  it('refuses a global-store without the top-level redis, as before', async () => {
    await expect(FrontMcpInstance.createDirect(serverWith({ type: 'global-store' }))).rejects.toThrow(
      'Plugin "CachePlugin" requires global "redis" configuration',
    );
  });

  it('builds a global-store on the top-level redis', async () => {
    const server = await FrontMcpInstance.createDirect(serverWith({ type: 'global-store' }, { redis }));
    await server.dispose();

    expect(redisClient).toHaveBeenCalledWith(expect.objectContaining(redis));
  });
});
