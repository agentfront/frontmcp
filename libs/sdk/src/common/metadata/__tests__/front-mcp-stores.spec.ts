import { withoutStores, withStoresOf } from '../front-mcp-stores';

const stores = {
  redis: { url: 'redis://cache:6379' },
  pubsub: { host: 'pubsub' },
  sqlite: { path: '/data/sessions.sqlite' },
  jobs: { enabled: true, store: { redis: { url: 'redis://jobs:6379' } } },
  tasks: { enabled: true, redis: { url: 'redis://tasks:6379' }, sqlite: { path: '/data/tasks.sqlite' } },
  transport: {
    protocol: 'legacy',
    persistence: { redis: { url: 'redis://sessions:6379' } },
    eventStore: { enabled: true, provider: 'redis', redis: { url: 'redis://events:6379' } },
  },
  elicitation: { enabled: true, redis: { url: 'redis://elicitation:6379' } },
  throttle: { enabled: true, storage: { type: 'memory' } },
  auth: {
    mode: 'local',
    tokenStorage: { redis: { host: 'tokens' } },
    secureStore: { sqlite: { path: '/data/secrets.sqlite' } },
  },
};

describe('the store settings of a server config', () => {
  it('are left out, and every other setting is kept', () => {
    expect(withoutStores({ info: { name: 'stores' }, ...stores })).toEqual({
      info: { name: 'stores' },
      jobs: { enabled: true, store: undefined },
      tasks: { enabled: true, redis: undefined, sqlite: undefined },
      transport: { protocol: 'legacy', persistence: undefined, eventStore: undefined },
      elicitation: { enabled: true, redis: undefined },
      throttle: { enabled: true, storage: undefined },
      auth: { mode: 'local', tokenStorage: undefined, secureStore: undefined },
    });
  });

  it('leave a setting that is not an object as given, for the schema to refuse', () => {
    const jobs = Object.assign([], { enabled: true, store: false });

    expect(withoutStores({ jobs, tasks: 'all' })).toEqual({ jobs, tasks: 'all' });
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
