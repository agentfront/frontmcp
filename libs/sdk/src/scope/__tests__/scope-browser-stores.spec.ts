/**
 * In a browser, startup refuses in one BrowserStoreUnavailableError every store that would open Redis or SQLite: the
 * SDK's and the ones its plugins declare (`static browserStores`), before any of them opens. A plugin whose options
 * only exist once its registry builds it (`init({ useFactory })`) is refused there, before its providers are built.
 */
import 'reflect-metadata';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { App, DynamicPlugin, LogLevel, Plugin, type ProviderType } from '../../common';
import { BrowserStoreUnavailableError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { PluginStoreInBrowser } from '../browser-stores';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const KvStoreToken = Symbol('kv:store');
const openedStores: string[] = [];

interface KvOptions {
  type?: 'redis' | 'memory';
}

@Plugin({ name: 'kv' })
class KvPlugin extends DynamicPlugin<KvOptions> {
  static override browserStores = ({ type }: KvOptions): PluginStoreInBrowser[] => [
    { plugin: 'KvPlugin', option: type === 'redis' ? "type: 'redis'" : undefined, memory: "type: 'memory'" },
  ];

  static override dynamicProviders = ({ type = 'memory' }: KvOptions): ProviderType[] => [
    {
      name: 'kv:store',
      provide: KvStoreToken,
      inject: () => [] as const,
      useFactory: () => {
        openedStores.push(type);
        return { type };
      },
    },
  ];
}

@App({ name: 'browser-stores-app' })
class BrowserStoresApp {}

const redis = { provider: 'redis' as const, host: '127.0.0.1', port: 6379 };

async function start(options: Record<string, unknown>): Promise<void> {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'scope-browser-stores', version: '0.0.0' },
    apps: [BrowserStoresApp],
    logging: { level: LogLevel.Off },
    ...options,
  });
  await server.dispose();
}

beforeEach(() => {
  runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser', deployment: 'standalone' }));
});

afterEach(() => {
  runtimeContext.mockImplementation(realRuntimeContext);
  openedStores.length = 0;
});

describe('stores in a browser, at startup', () => {
  it("lists the SDK's stores and the plugins' in one refusal, before any of them opens", async () => {
    const startup = start({
      redis,
      plugins: [KvPlugin.init({ type: 'redis' })],
      throttle: { enabled: true, storage: { type: 'sqlite', sqlite: { path: '/var/lib/app/limits.sqlite' } } },
    });

    await expect(startup).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(startup).rejects.toMatchObject({
      stores: [
        ['tasks', 'redis'],
        ['rateLimits', "throttle.storage: { type: 'sqlite' }"],
        ['KvPlugin', "type: 'redis'"],
      ],
    });
    expect(openedStores).toEqual([]);
  });

  it('refuses a store whose options come from init({ useFactory }) before the plugin builds it', async () => {
    const startup = start({
      tasks: { store: false },
      plugins: [KvPlugin.init({ useFactory: () => ({ type: 'redis' as const }) })],
    });

    await expect(startup).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['KvPlugin', "type: 'redis'"]],
    });
    expect(openedStores).toEqual([]);
  });

  it('starts a plugin given as a hand-written value record, whose options are not recorded', async () => {
    await start({ tasks: { store: false }, plugins: [{ provide: KvPlugin, useValue: new KvPlugin() }] });

    expect(openedStores).toEqual([]);
  });

  it('starts a plugin on memory with the top-level redis left in the config', async () => {
    await start({ redis, tasks: { store: false }, plugins: [KvPlugin.init({ type: 'memory' })] });

    expect(openedStores).toEqual(['memory']);
  });
});
