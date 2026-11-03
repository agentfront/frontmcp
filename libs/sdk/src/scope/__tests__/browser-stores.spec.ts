import { BrowserStoreUnavailableError, InternalMcpError } from '../../errors';
import {
  elicitationServerStore,
  refusePluginStoreInBrowser,
  refuseServerStoresInBrowser,
  tasksServerStore,
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
