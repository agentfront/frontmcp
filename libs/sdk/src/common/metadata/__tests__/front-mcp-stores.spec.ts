import { withoutStores, withStoresOf } from '../front-mcp-stores';

const stores = {
  redis: { url: 'redis://cache:6379' },
  pubsub: { host: 'pubsub' },
  sqlite: { path: '/data/sessions.sqlite' },
  jobs: { enabled: true, store: { redis: { url: 'redis://jobs:6379' } } },
  tasks: { enabled: true, redis: { url: 'redis://tasks:6379' }, sqlite: { path: '/data/tasks.sqlite' } },
  transport: { protocol: 'legacy', persistence: { redis: { url: 'redis://sessions:6379' } } },
  throttle: { enabled: true, storage: { type: 'memory' } },
};

describe('the store settings of a server config', () => {
  it('are left out, and every other setting is kept', () => {
    expect(withoutStores({ info: { name: 'stores' }, ...stores })).toEqual({
      info: { name: 'stores' },
      jobs: { enabled: true, store: undefined },
      tasks: { enabled: true, redis: undefined, sqlite: undefined },
      transport: { protocol: 'legacy', persistence: undefined },
      throttle: { enabled: true, storage: undefined },
    });
  });

  it('are put back as the source gives them', () => {
    expect(withStoresOf(withoutStores(stores), stores)).toEqual(stores);
  });

  it('are put back only where the config has the setting they belong to, and only those the source has', () => {
    const restored = withStoresOf({ info: { name: 'stores' }, tasks: { enabled: true } }, stores);

    expect(restored).toEqual({
      info: { name: 'stores' },
      redis: stores.redis,
      pubsub: stores.pubsub,
      sqlite: stores.sqlite,
      tasks: { enabled: true, redis: stores.tasks.redis, sqlite: stores.tasks.sqlite },
    });
    expect(withStoresOf({ jobs: { enabled: true } }, { jobs: { enabled: true } })).toEqual({ jobs: { enabled: true } });
  });
});
