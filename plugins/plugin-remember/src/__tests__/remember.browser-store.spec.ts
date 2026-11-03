/**
 * A browser has no TCP socket for Redis: in a browser, startup refuses a RememberPlugin store on Redis before it opens,
 * in the server's one BrowserStoreUnavailableError, naming `type: 'memory'` (#1033). A Node server keeps its Redis.
 */
import 'reflect-metadata';

import Redis from 'ioredis';

import { App, BrowserStoreUnavailableError, FrontMcpInstance, LogLevel, type DirectMcpServer } from '@frontmcp/sdk';
import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import RememberRedisProvider from '../providers/remember-redis.provider';
import RememberPlugin from '../remember.plugin';
import type { RememberPluginOptionsInput } from '../remember.types';

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

type StoreFactory = { name: string; useFactory: (config: unknown) => unknown };

function globalStoreFactory(): StoreFactory {
  const providers = RememberPlugin.dynamicProviders({ type: 'global-store' }) as unknown as StoreFactory[];
  const factory = providers.find((provider) => provider.name === 'remember:store:global');
  if (!factory) throw new Error('RememberPlugin registered no global-store provider');
  return factory;
}

const started: DirectMcpServer[] = [];

async function startWith(remember: RememberPluginOptionsInput, options: Record<string, unknown> = {}): Promise<void> {
  @App({
    id: 'remembering',
    name: 'Remembering',
    plugins: [RememberPlugin.init({ skipLegacyPurge: true, ...remember })],
  })
  class RememberingApp {}

  started.push(
    await FrontMcpInstance.createDirect({
      info: { name: 'remember-browser-store', version: '1.0.0' },
      apps: [RememberingApp],
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

describe('RememberPlugin in a browser', () => {
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
      stores: [['RememberPlugin', "type: 'global-store'"]],
      message:
        "A browser cannot open Redis or SQLite: RememberPlugin would use type: 'global-store' " +
        "(set type: 'memory' in place of type: 'global-store')",
    });
    expect(redisClient).not.toHaveBeenCalled();
  });

  it.each([
    ["type: 'redis'", { type: 'redis', config: { host: '127.0.0.1', port: 6379 } }],
    ["type: 'redis-client'", { type: 'redis-client', client: {} }],
  ] as const)('refuses %s at startup, before it connects', async (option, remember) => {
    const startup = startWith(remember as RememberPluginOptionsInput);

    await expect(startup).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['RememberPlugin', option]],
      message: `A browser cannot open Redis or SQLite: RememberPlugin would use ${option} (set type: 'memory' in place of ${option})`,
    });
    expect(redisClient).not.toHaveBeenCalled();
  });

  it("lists the store in the server's one refusal, with the stores that take the top-level redis", async () => {
    const startup = startWith({ type: 'global-store' }, { redis, tasks: {} });

    await expect(startup).rejects.toMatchObject({
      stores: [
        ['tasks', 'redis'],
        ['RememberPlugin', "type: 'global-store'"],
      ],
    });
    expect(redisClient).not.toHaveBeenCalled();
  });

  it('starts a memory store, and a global-store on Vercel KV, with the top-level redis left in the config', async () => {
    await startWith({ type: 'memory' }, { redis });
    expect(globalStoreFactory().useFactory({ redis: { provider: 'vercel-kv' } })).toBeDefined();

    expect(redisClient).not.toHaveBeenCalled();
  });
});

describe('RememberPlugin on Node', () => {
  it('keeps a global-store on the top-level redis', () => {
    expect(globalStoreFactory().useFactory({ redis })).toBeInstanceOf(RememberRedisProvider);
  });

  it('connects a redis store when the server starts, not when init() runs', async () => {
    const config = { host: '127.0.0.1', port: 6379 };
    RememberPlugin.init({ type: 'redis', config });
    expect(redisClient).not.toHaveBeenCalled();

    await startWith({ type: 'redis', config });
    expect(redisClient).toHaveBeenCalledWith(expect.objectContaining(config));
  });

  it('gives the servers that install one redis init() its one client', async () => {
    const remember = RememberPlugin.init({
      skipLegacyPurge: true,
      type: 'redis',
      config: { host: '127.0.0.1', port: 6379 },
    });

    for (const id of ['first', 'second']) {
      @App({ id: `remembering-${id}`, name: `Remembering ${id}`, plugins: [remember] })
      class RememberingApp {}
      started.push(
        await FrontMcpInstance.createDirect({
          info: { name: `remember-${id}`, version: '1.0.0' },
          apps: [RememberingApp],
          logging: { level: LogLevel.Off },
          tasks: { store: false },
        }),
      );
    }

    expect(redisClient).toHaveBeenCalledTimes(1);
  });
});
