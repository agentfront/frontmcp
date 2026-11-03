import 'reflect-metadata';

import {
  App,
  BrowserStoreUnavailableError,
  FrontMcp,
  refusePluginStoreInBrowser,
  type BrowserRefusedStore,
  type PluginStoreInBrowser,
} from '@frontmcp/sdk';

@App({ name: 'memory-stores' })
class MemoryStoresApp {}

@FrontMcp({
  info: { name: 'memory-stores', version: '1.0.0' },
  apps: [MemoryStoresApp],
  redis: { provider: 'redis', host: 'localhost' },
  sqlite: { path: '/var/lib/app/state.sqlite' },
  tasks: { store: false },
  elicitation: { enabled: true, store: false, persistent: { storage: { type: 'memory' } } },
  jobs: { enabled: true, store: false },
})
export class MemoryStoresServer {}

export function refusedStores(error: unknown): BrowserRefusedStore[] {
  return error instanceof BrowserStoreUnavailableError ? error.stores.map(([store]) => store) : [];
}

export function refuseCacheOnRedisInBrowser(): void {
  const cacheOnRedis: PluginStoreInBrowser = {
    plugin: 'CachePlugin',
    option: "type: 'redis'",
    memory: "type: 'memory'",
  };
  refusePluginStoreInBrowser(cacheOnRedis);
  // @ts-expect-error a plugin store names the option that keeps it in memory
  refusePluginStoreInBrowser({ plugin: 'CachePlugin', option: "type: 'redis'" });
}

export const cacheRefusal = new BrowserStoreUnavailableError([['CachePlugin', "type: 'redis'"]], {
  CachePlugin: "type: 'memory'",
});

@FrontMcp({
  info: { name: 'memory-stores-bad', version: '1.0.0' },
  apps: [MemoryStoresApp],
  // @ts-expect-error tasks.store takes false only
  tasks: { store: true },
  // @ts-expect-error elicitation.store takes false only
  elicitation: { enabled: true, store: 'memory' },
  // @ts-expect-error jobs.store takes false or an object
  jobs: { enabled: true, store: true },
})
export class InvalidStoreSwitchesServer {}
