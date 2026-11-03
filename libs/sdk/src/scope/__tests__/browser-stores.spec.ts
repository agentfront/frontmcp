import 'reflect-metadata';

import { App, DynamicPlugin, Job, JobContext, Plugin } from '../../common';
import { BrowserStoreUnavailableError, InternalMcpError } from '../../errors';
import {
  elicitationServerStore,
  refusePluginStoreInBrowser,
  refuseServerStoresInBrowser,
  refuseStoresInBrowser,
  tasksServerStore,
  type PluginStoreInBrowser,
} from '../browser-stores';

const redis = { provider: 'redis' as const, host: 'cache.internal', port: 6379 };
const vercelKv = { provider: 'vercel-kv' as const };
const sqlite = { path: '/var/lib/app/state.sqlite' };

describe('tasksServerStore', () => {
  it('names the option whose Redis or SQLite the tasks would open', () => {
    expect(tasksServerStore({ tasks: { sqlite }, redis })).toBe('tasks.sqlite');
    expect(tasksServerStore({ tasks: { redis }, sqlite })).toBe('tasks.redis');
    expect(tasksServerStore({ redis, sqlite })).toBe('redis');
    expect(tasksServerStore({ sqlite })).toBe('sqlite');
  });

  it('names none with tasks.store: false, with tasks off, on Vercel KV or with nothing set', () => {
    expect(tasksServerStore({ tasks: { store: false }, redis, sqlite })).toBeUndefined();
    expect(tasksServerStore({ tasks: { enabled: false }, redis, sqlite })).toBeUndefined();
    expect(tasksServerStore({ redis: vercelKv, sqlite })).toBeUndefined();
    expect(tasksServerStore({})).toBeUndefined();
  });
});

describe('elicitationServerStore', () => {
  it('names the option whose Redis or SQLite elicitation would open', () => {
    expect(elicitationServerStore({ elicitation: { enabled: true, redis }, sqlite })).toBe('elicitation.redis');
    expect(elicitationServerStore({ elicitation: { enabled: true }, redis, sqlite })).toBe('redis');
    expect(elicitationServerStore({ elicitation: { enabled: true }, sqlite })).toBe('sqlite');
  });

  it('names none with elicitation.store: false, with elicitation off or with nothing set', () => {
    expect(elicitationServerStore({ elicitation: { enabled: true, store: false }, redis, sqlite })).toBeUndefined();
    expect(elicitationServerStore({ elicitation: { enabled: false }, redis, sqlite })).toBeUndefined();
    expect(elicitationServerStore({ redis, sqlite })).toBeUndefined();
    expect(elicitationServerStore({ elicitation: { enabled: true } })).toBeUndefined();
  });
});

describe('refuseServerStoresInBrowser', () => {
  it('refuses, in a browser, every store that would open Redis or SQLite, naming the option that turns it off', () => {
    let refusal: unknown;
    try {
      refuseServerStoresInBrowser({ tasks: 'redis', elicitation: undefined, jobs: 'jobs.store.sqlite' }, 'browser');
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BrowserStoreUnavailableError);
    expect(refusal).toBeInstanceOf(InternalMcpError);
    expect(refusal).toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [
        ['tasks', 'redis'],
        ['jobs', 'jobs.store.sqlite'],
      ],
    });
    expect((refusal as Error).message).toBe(
      'A browser cannot open Redis or SQLite: background tasks would use the top-level redis (set tasks.store: false ' +
        'for memory, or leave redis out of the browser build); jobs would use jobs.store.sqlite ' +
        '(set jobs.store: false in place of jobs.store.sqlite)',
    );
  });

  it("names elicitation's and the questions' switches", () => {
    expect(() =>
      refuseServerStoresInBrowser({ elicitation: 'sqlite', questions: 'the default questions.sqlite file' }, 'browser'),
    ).toThrow(
      'elicitation would use the top-level sqlite (set elicitation.store: false for memory, or leave sqlite out ' +
        'of the browser build); persistent questions would use the default questions.sqlite file ' +
        "(set elicitation.persistent.storage: { type: 'memory' } in place of the default questions.sqlite file)",
    );
  });

  it('lets a browser start when no store opens Redis or SQLite', () => {
    expect(() => refuseServerStoresInBrowser({ tasks: undefined, jobs: undefined }, 'browser')).not.toThrow();
  });

  it('refuses nothing outside a browser', () => {
    expect(() => refuseServerStoresInBrowser({ tasks: 'redis', jobs: 'sqlite' }, 'node')).not.toThrow();
    expect(() => refuseServerStoresInBrowser({ tasks: 'redis' })).not.toThrow();
  });
});

describe('refusePluginStoreInBrowser', () => {
  const cacheOnRedis = { plugin: 'CachePlugin', option: "type: 'global-store'", memory: "type: 'memory'" };

  it("refuses, in a browser, a plugin's store that would open Redis or SQLite, naming the plugin's memory option", () => {
    let refusal: unknown;
    try {
      refusePluginStoreInBrowser(cacheOnRedis, 'browser');
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BrowserStoreUnavailableError);
    expect(refusal).toMatchObject({
      code: 'BROWSER_STORE_UNAVAILABLE',
      stores: [['CachePlugin', "type: 'global-store'"]],
    });
    expect((refusal as Error).message).toBe(
      "A browser cannot open Redis or SQLite: CachePlugin would use type: 'global-store' " +
        "(set type: 'memory' in place of type: 'global-store')",
    );
  });

  it("names the plugin's memory option for a plugin named like one of the SDK's stores", () => {
    expect(() => refusePluginStoreInBrowser({ ...cacheOnRedis, plugin: 'jobs' }, 'browser')).toThrow(
      "jobs would use type: 'global-store' (set type: 'memory' in place of type: 'global-store')",
    );
  });

  it('lets a browser start a plugin store that opens neither', () => {
    expect(() => refusePluginStoreInBrowser({ ...cacheOnRedis, option: undefined }, 'browser')).not.toThrow();
  });

  it('refuses nothing outside a browser', () => {
    expect(() => refusePluginStoreInBrowser(cacheOnRedis, 'node')).not.toThrow();
    expect(() => refusePluginStoreInBrowser(cacheOnRedis)).not.toThrow();
  });
});

describe('BrowserStoreUnavailableError', () => {
  it("reads without a switch for a plugin's store whose memory option is not given", () => {
    const unnamed = BrowserStoreUnavailableError as unknown as new (stores: Array<[string, string]>) => Error;

    expect(new unnamed([['MyPlugin', "type: 'redis'"]]).message).toBe(
      "A browser cannot open Redis or SQLite: MyPlugin would use type: 'redis'",
    );
    expect(new BrowserStoreUnavailableError([['MyPlugin', "type: 'redis'"]], { OtherPlugin: 'x' }).message).toBe(
      "A browser cannot open Redis or SQLite: MyPlugin would use type: 'redis'",
    );
  });

  it("names the switch of the SDK's explicit stores", () => {
    expect(
      new BrowserStoreUnavailableError([
        ['rateLimits', "throttle.storage: { type: 'redis' }"],
        ['authTokens', 'auth.tokenStorage.sqlite'],
        ['skillsCache', 'skillsConfig.cache.redis'],
        ['resourceStore', "storage: { type: 'sqlite' }"],
        ['sqliteStorage', 'sqliteStorageProvider()'],
      ]).message,
    ).toBe(
      'A browser cannot open Redis or SQLite: ' +
        "rate limits would use throttle.storage: { type: 'redis' } (set throttle.storage: { type: 'memory' } in place of throttle.storage: { type: 'redis' }); " +
        "auth tokens would use auth.tokenStorage.sqlite (set auth.tokenStorage: 'memory' in place of auth.tokenStorage.sqlite); " +
        'the skills HTTP cache would use skillsConfig.cache.redis (set a skillsConfig.cache without redis in place of skillsConfig.cache.redis); ' +
        "a resource store would use storage: { type: 'sqlite' } (set storage: { type: 'memory' } in place of storage: { type: 'sqlite' }); " +
        'a storage provider would use sqliteStorageProvider() (set a provider of createMemoryStorage() in place of sqliteStorageProvider())',
    );
  });
});

describe('refuseStoresInBrowser', () => {
  interface KvOptions {
    type?: 'redis' | 'memory' | 'global-store';
  }

  @Plugin({ name: 'kv' })
  class KvPlugin extends DynamicPlugin<KvOptions> {
    static override browserStores = ({ type }: KvOptions, server: { redis?: unknown }): PluginStoreInBrowser[] => [
      {
        plugin: 'KvPlugin',
        option: type === 'redis' || (type === 'global-store' && server.redis) ? `type: '${type}'` : undefined,
        memory: "type: 'memory'",
      },
    ];
  }

  async function refusal(options: Parameters<typeof refuseStoresInBrowser>[0]): Promise<unknown> {
    try {
      await refuseStoresInBrowser(options, 'browser');
    } catch (error) {
      return error;
    }
    return undefined;
  }

  it("lists every store in one refusal: the SDK's and those its plugins declare, on the server and on its apps", async () => {
    @App({ name: 'kv-app', plugins: [KvPlugin.init({ type: 'global-store' })] })
    class KvApp {}

    const error = await refusal({
      redis,
      apps: [KvApp],
      plugins: [KvPlugin.init({ type: 'redis' })],
      elicitation: { enabled: true },
      throttle: { enabled: true, storage: { type: 'redis' } },
      auth: { mode: 'local', tokenStorage: { sqlite } },
      skillsConfig: { cache: { enabled: true, redis: { provider: 'redis' } } },
    });

    expect(error).toBeInstanceOf(BrowserStoreUnavailableError);
    expect(error).toMatchObject({
      stores: [
        ['tasks', 'redis'],
        ['elicitation', 'redis'],
        ['rateLimits', "throttle.storage: { type: 'redis' }"],
        ['authTokens', 'auth.tokenStorage.sqlite'],
        ['skillsCache', 'skillsConfig.cache.redis'],
        ['KvPlugin', "type: 'redis'"],
        ['KvPlugin', "type: 'global-store'"],
      ],
    });
    expect((error as Error).message).toContain(
      "KvPlugin would use type: 'redis' (set type: 'memory' in place of type: 'redis')",
    );
  });

  it('lists the throttle.storage of the guard: with throttle on, and with it off for auth.publicAccess.rateLimit', async () => {
    const onRedis = { stores: [['rateLimits', "throttle.storage: { type: 'redis' }"]] };
    const storage = { type: 'redis' };

    expect(await refusal({ throttle: { enabled: true, storage } })).toMatchObject(onRedis);
    expect(
      await refusal({
        throttle: { enabled: false, storage },
        auth: { mode: 'public', publicAccess: { rateLimit: 60 } },
      }),
    ).toMatchObject(onRedis);
    expect(
      await refusal({ throttle: { enabled: false, storage }, auth: { mode: 'public', publicAccess: {} } }),
    ).toMatchObject(onRedis);
    expect(await refusal({ throttle: { enabled: false, storage } })).toBeUndefined();
    expect(
      await refusal({
        throttle: { enabled: false, storage },
        auth: { mode: 'public', publicAccess: { rateLimit: 0 } },
      }),
    ).toBeUndefined();
    expect(await refusal({ throttle: { enabled: true, storage: { type: 'memory' } } })).toBeUndefined();
  });

  it('lists persistent questions and jobs, enabled or declared on an app', async () => {
    @Job({ name: 'nightly', inputSchema: {}, outputSchema: {} })
    class NightlyJob extends JobContext {
      async execute() {
        return {};
      }
    }

    @App({ name: 'job-app', jobs: [NightlyJob] })
    class JobApp {}

    @App({ name: 'no-job-app' })
    class NoJobApp {}

    expect(
      await refusal({
        sqlite,
        tasks: { store: false },
        elicitation: { enabled: true, store: false, persistent: true },
        jobs: { enabled: true },
        apps: [NoJobApp],
      }),
    ).toMatchObject({
      stores: [
        ['questions', 'sqlite'],
        ['jobs', 'sqlite'],
      ],
    });
    expect(await refusal({ sqlite, tasks: { store: false }, apps: [JobApp] })).toMatchObject({
      stores: [['jobs', 'sqlite']],
    });
    expect(await refusal({ sqlite, tasks: { store: false }, apps: [NoJobApp] })).toBeUndefined();
    expect(
      await refusal({ sqlite, tasks: { store: false }, jobs: { enabled: false }, apps: [JobApp] }),
    ).toBeUndefined();
  });

  it("lists the secure store a local auth keeps on Redis or SQLite, naming auth.secureStore: 'memory'", async () => {
    const error = await refusal({
      tasks: { store: false },
      auth: { mode: 'local', tokenStorage: { sqlite }, secureStore: { redis: { host: '127.0.0.1' } } },
    });

    expect(error).toMatchObject({
      stores: [
        ['authTokens', 'auth.tokenStorage.sqlite'],
        ['secureStore', 'auth.secureStore.redis'],
      ],
    });
    expect((error as Error).message).toContain(
      "the secure store would use auth.secureStore.redis (set auth.secureStore: 'memory' in place of auth.secureStore.redis)",
    );
    expect(await refusal({ tasks: { store: false }, auth: { mode: 'local', secureStore: { sqlite } } })).toMatchObject({
      stores: [['secureStore', 'auth.secureStore.sqlite']],
    });
  });

  it('lets a browser start with memory stores, Vercel KV and stores that are off', async () => {
    expect(
      await refusal({
        redis: vercelKv,
        plugins: [KvPlugin.init({ type: 'memory' }), KvPlugin],
        throttle: { enabled: false, storage: { type: 'redis' } },
        auth: { mode: 'local', tokenStorage: 'memory', secureStore: { sqlite: undefined, scope: 'session' } },
        skillsConfig: { cache: { enabled: true, redis: { provider: 'vercel-kv' } } },
        elicitation: { enabled: true, persistent: { storage: { type: 'memory' } } },
      }),
    ).toBeUndefined();
  });

  it('refuses nothing outside a browser', async () => {
    await expect(
      refuseStoresInBrowser({ redis, plugins: [KvPlugin.init({ type: 'redis' })] }, 'node'),
    ).resolves.toBeUndefined();
  });
});
