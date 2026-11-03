/**
 * A browser has no TCP socket for Redis: in a browser, a CachePlugin store on Redis is refused before it opens, with
 * BrowserStoreUnavailableError naming `type: 'memory'` (#1033). A Node server keeps its Redis.
 */
import 'reflect-metadata';

import Redis from 'ioredis';

import { App, BrowserStoreUnavailableError, FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';
import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import CachePlugin from '../cache.plugin';
import type { CachePluginOptions } from '../cache.types';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({ on: jest.fn(), quit: jest.fn() })));
jest.mock('@vercel/kv', () => ({ kv: {}, createClient: jest.fn() }));
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;
const redisClient = Redis as unknown as jest.Mock;

const redis = { provider: 'redis' as const, host: '127.0.0.1', port: 6379 };
const redisConfig = { host: '127.0.0.1', port: 6379 };

const started: DirectMcpServer[] = [];

async function startWith(cache: CachePluginOptions, options: Record<string, unknown> = {}): Promise<void> {
  @App({ id: 'cached', name: 'Cached', plugins: [CachePlugin.init(cache)] })
  class CachedApp {}

  started.push(
    await FrontMcpInstance.createDirect({
      info: { name: 'cache-browser-store', version: '1.0.0' },
      apps: [CachedApp],
      logging: { level: LogLevel.Off },
      tasks: { store: false },
      transport: { persistence: false },
      ...options,
    }),
  );
}

afterEach(async () => {
  runtimeContext.mockImplementation(realRuntimeContext);
  await Promise.all(started.splice(0).map((server) => server.dispose()));
  jest.clearAllMocks();
});

describe('CachePlugin in a browser', () => {
  beforeEach(() => {
    runtimeContext.mockImplementation(() => ({
      ...realRuntimeContext(),
      runtime: 'browser',
      deployment: 'standalone',
    }));
  });

  it("refuses at startup a global-store on the top-level redis, naming type: 'memory'", async () => {
    const startup = startWith({ type: 'global-store' }, { redis });

    await expect(startup).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(startup).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['CachePlugin', "type: 'global-store'"]],
      message:
        "A browser cannot open Redis or SQLite: CachePlugin would use type: 'global-store' " +
        "(set type: 'memory' in place of type: 'global-store')",
    });
    expect(redisClient).not.toHaveBeenCalled();
  });

  it.each([
    ["type: 'redis'", { type: 'redis', config: redisConfig }],
    ["type: 'redis-client'", { type: 'redis-client', client: {} }],
  ] as const)('refuses %s before it connects', (option, cache) => {
    expect(() => CachePlugin.init(cache as CachePluginOptions)).toThrow(
      `CachePlugin would use ${option} (set type: 'memory' in place of ${option})`,
    );
    expect(redisClient).not.toHaveBeenCalled();
  });

  it('starts a memory cache, and a global-store on Vercel KV, with the top-level redis left in the config', async () => {
    await startWith({ type: 'memory' }, { redis });
    await startWith({ type: 'global-store' }, { redis: { provider: 'vercel-kv' } });

    expect(redisClient).not.toHaveBeenCalled();
  });
});

describe('CachePlugin on Node', () => {
  it('keeps a global-store on the top-level redis', async () => {
    await startWith({ type: 'global-store' }, { redis });

    expect(redisClient).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: 6379 }));
  });
});
