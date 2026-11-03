/**
 * A build boots the server only to read it, and opens none of its stores (#1041). There a RememberPlugin store is not
 * built: a `global-store` needs no top-level `redis`, which the build leaves out, and a `type: 'redis'` store opens no
 * client. A server that starts builds them as before.
 */
import 'reflect-metadata';

import Redis from 'ioredis';

import { App, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import type { RememberPluginOptionsInput } from '../remember.types';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn(), quit: jest.fn() })));

const redisClient = Redis as unknown as jest.Mock;
const redis = { host: '127.0.0.1', port: 6379 };

function serverWith(remember: RememberPluginOptionsInput, options: Record<string, unknown> = {}) {
  @App({
    id: 'remembering',
    name: 'Remembering',
    plugins: [RememberPlugin.init({ skipLegacyPurge: true, ...remember })],
  })
  class RememberingApp {}

  return {
    info: { name: 'remember-build-stores', version: '1.0.0' },
    apps: [RememberingApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false as const },
    ...options,
  };
}

afterEach(() => jest.clearAllMocks());

describe("RememberPlugin in a build's boot", () => {
  it.each([
    ["type: 'global-store'", { type: 'global-store' }],
    ["type: 'redis'", { type: 'redis', config: redis }],
  ] as const)('reads a server whose store is on %s without building it', async (_option, remember) => {
    const instance = await FrontMcpInstance.createForManifest(serverWith(remember, { redis }));
    await instance.shutdown();

    expect(redisClient).not.toHaveBeenCalled();
  });
});

describe('RememberPlugin on a server that starts', () => {
  it('refuses a global-store without the top-level redis, as before', async () => {
    await expect(FrontMcpInstance.createDirect(serverWith({ type: 'global-store' }))).rejects.toThrow(
      'Plugin "RememberPlugin" requires global "redis" configuration',
    );
  });

  it('builds a global-store on the top-level redis', async () => {
    const server = await FrontMcpInstance.createDirect(serverWith({ type: 'global-store' }, { redis }));
    await server.dispose();

    expect(redisClient).toHaveBeenCalledWith(expect.objectContaining(redis));
  });
});
