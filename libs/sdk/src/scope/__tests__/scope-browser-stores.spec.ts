/**
 * In a browser, startup refuses in one BrowserStoreUnavailableError every store that would open Redis or SQLite: the
 * SDK's and the ones its plugins declare (`static browserStores`), before any of them opens. A plugin whose options
 * only exist once its registry builds it (`init({ useFactory })`) is refused there, before its providers are built.
 */
import 'reflect-metadata';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import {
  App,
  DynamicPlugin,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Tool,
  ToolContext,
  type LogRecord,
  type ProviderType,
} from '../../common';
import { BrowserStoreUnavailableError, RateLimitError } from '../../errors';
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
      throttle: {
        enabled: true,
        storage: { type: 'sqlite', sqlite: { path: '/var/lib/app/limits.sqlite' }, fallback: 'error' },
      },
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

  it('refuses the guard publicAccess.rateLimit builds on throttle.storage with throttle off', async () => {
    const throttle = {
      enabled: false,
      storage: { type: 'redis', redis: { config: { host: '127.0.0.1', port: 6379 } }, fallback: 'error' },
    };

    await expect(start({ throttle, auth: { mode: 'public', publicAccess: { rateLimit: 60 } } })).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['rateLimits', "throttle.storage: { type: 'redis' }"]],
    });
    await expect(start({ throttle, auth: { mode: 'public' } })).resolves.toBeUndefined();
  });

  it('starts a plugin on memory with the top-level redis left in the config', async () => {
    await start({ redis, tasks: { store: false }, plugins: [KvPlugin.init({ type: 'memory' })] });

    expect(openedStores).toEqual(['memory']);
  });
});

/** A Redis client the caller built: it answers the rate limiter's commands and keeps the keys it counted. */
class CallerRedis {
  readonly counters = new Map<string, number>();
  readonly commands: string[] = [];

  async ping(): Promise<string> {
    this.commands.push('ping');
    return 'PONG';
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    this.commands.push('mget');
    return keys.map((key) => (this.counters.has(key) ? String(this.counters.get(key)) : null));
  }

  async incr(key: string): Promise<number> {
    this.commands.push('incr');
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async expire(): Promise<number> {
    this.commands.push('expire');
    return 1;
  }

  async quit(): Promise<string> {
    this.commands.push('quit');
    return 'OK';
  }

  on(): this {
    return this;
  }

  removeListener(): this {
    return this;
  }
}

const browserWarnings: string[] = [];

@LogTransport({ name: 'BrowserStoresWarnings', description: 'Keeps the warnings a browser server logs' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) browserWarnings.push(record.message);
  }
}

@Tool({ name: 'count_me', inputSchema: {}, rateLimit: { maxRequests: 2, windowMs: 60_000 } })
class CountMeTool extends ToolContext {
  async execute() {
    return 'counted';
  }
}

@App({ name: 'rate-limited-app', tools: [CountMeTool] })
class RateLimitedApp {}

describe('the guard on throttle.storage in a browser', () => {
  const { NODE_ENV } = process.env;

  afterEach(() => {
    process.env['NODE_ENV'] = NODE_ENV;
    browserWarnings.length = 0;
  });

  type ThrottleOptions = NonNullable<Parameters<typeof FrontMcpInstance.createDirect>[0]['throttle']>;

  async function callsUntilLimited(throttle: ThrottleOptions): Promise<string[]> {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'scope-browser-guard', version: '0.0.0' },
      apps: [RateLimitedApp],
      tasks: { store: false },
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
      throttle,
    });
    try {
      const outcomes: string[] = [];
      for (let call = 0; call < 3; call++) {
        outcomes.push(
          await server.callTool('count_me', {}).then(
            () => 'ok',
            (error: unknown) => (error instanceof RateLimitError ? 'limited' : String(error)),
          ),
        );
      }
      return outcomes;
    } finally {
      await server.dispose();
    }
  }

  it("counts on a Redis client the caller built, even with fallback: 'error' in production", async () => {
    process.env['NODE_ENV'] = 'production';
    const client = new CallerRedis();

    const outcomes = await callsUntilLimited({
      enabled: true,
      storage: { type: 'redis', redis: { client }, fallback: 'error' },
    });

    expect(outcomes).toEqual(['ok', 'ok', 'limited']);
    expect(client.commands).toEqual(expect.arrayContaining(['ping', 'mget', 'incr', 'expire']));
    expect(browserWarnings.filter((message) => message.includes('A browser cannot open'))).toEqual([]);
  });

  it("starts on per-instance counters for a Redis it can't open with fallback: 'memory', saying so once", async () => {
    const outcomes = await callsUntilLimited({
      enabled: true,
      storage: { type: 'redis', redis: { config: { host: '127.0.0.1', port: 1 } }, fallback: 'memory' },
    });

    expect(outcomes).toEqual(['ok', 'ok', 'limited']);
    expect(browserWarnings.filter((message) => message.includes('A browser cannot open'))).toEqual([
      "A browser cannot open Redis or SQLite: rate limits use per-instance counters in place of throttle.storage: { type: 'redis' } (throttle.storage.fallback: 'memory')",
    ]);
  });

  it("starts on per-instance counters without a fallback outside production, the guard's default", async () => {
    process.env['NODE_ENV'] = 'development';

    await expect(
      callsUntilLimited({
        enabled: true,
        storage: { type: 'redis', redis: { config: { host: '127.0.0.1', port: 1 } } },
      }),
    ).resolves.toEqual(['ok', 'ok', 'limited']);
  });

  it("starts the publicAccess.rateLimit guard on memory with throttle off and fallback: 'memory'", async () => {
    await expect(
      start({
        throttle: {
          enabled: false,
          storage: { type: 'redis', redis: { config: { host: '127.0.0.1', port: 1 } }, fallback: 'memory' },
        },
        auth: { mode: 'public', publicAccess: { rateLimit: 60 } },
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a Redis it can't open with fallback: 'error', set or by default in production", async () => {
    const storage = { type: 'redis', redis: { config: { host: '127.0.0.1', port: 1 } } };

    await expect(
      start({ throttle: { enabled: true, storage: { ...storage, fallback: 'error' } } }),
    ).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['rateLimits', "throttle.storage: { type: 'redis' }"]],
    });
    process.env['NODE_ENV'] = 'production';
    await expect(start({ throttle: { enabled: true, storage } })).rejects.toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['rateLimits', "throttle.storage: { type: 'redis' }"]],
    });
  });
});
