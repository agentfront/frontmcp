/**
 * @FrontMcp decorator — the store settings while a build reads the server (#1041).
 *
 * `frontmcp build` loads the entry with FRONTMCP_SCHEMA_EXTRACT and FRONTMCP_BUILD_EXTRACT set: the decorator
 * validates the config without its store settings, which the build never opens, and records them as given. The
 * generated CLI loads the server with FRONTMCP_SCHEMA_EXTRACT alone, and a server with neither: both still validate
 * them when the module loads.
 */
import 'reflect-metadata';

import { InvalidDecoratorMetadataError } from '../../../errors/decorator.errors';
import { FrontMcp, getDecoratorConfig } from '../front-mcp.decorator';

const SCHEMA_EXTRACT = 'FRONTMCP_SCHEMA_EXTRACT';
const BUILD_EXTRACT = 'FRONTMCP_BUILD_EXTRACT';

const unset = process.env['DECORATOR_BUILD_UNSET_VAR'] as string;
const sqlitePath = '/tmp/frontmcp-decorator-build-extract.sqlite';

const unsetStores: Array<[string, Record<string, unknown>]> = [
  ['redis', { redis: { url: unset } }],
  ['pubsub', { pubsub: { url: unset } }],
  ['sqlite', { sqlite: { path: sqlitePath, encryption: { secret: unset } } }],
  ['jobs.store', { jobs: { enabled: true, store: { redis: { url: unset } } } }],
  ['tasks.redis', { tasks: { redis: { url: unset } } }],
  ['tasks.sqlite', { tasks: { sqlite: { path: sqlitePath, encryption: { secret: unset } } } }],
  ['transport.persistence', { transport: { persistence: { redis: { url: unset } } } }],
];

const config = { info: { name: 'build-extract-test', version: '1.0.0' }, apps: [] };

function decorate(extra: Record<string, unknown>): unknown {
  class Server {}
  FrontMcp({ ...config, ...extra } as never)(Server);
  return Server;
}

describe('FrontMcp decorator — store settings while a build reads the server', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const flag of [SCHEMA_EXTRACT, BUILD_EXTRACT]) {
      saved[flag] = process.env[flag];
      delete process.env[flag];
    }
  });

  afterEach(() => {
    for (const flag of [SCHEMA_EXTRACT, BUILD_EXTRACT]) {
      if (saved[flag] === undefined) delete process.env[flag];
      else process.env[flag] = saved[flag];
    }
  });

  describe('under the build (FRONTMCP_SCHEMA_EXTRACT and FRONTMCP_BUILD_EXTRACT)', () => {
    beforeEach(() => {
      process.env[SCHEMA_EXTRACT] = '1';
      process.env[BUILD_EXTRACT] = '1';
    });

    it.each(unsetStores)('records a server whose %s takes an env var the build has not set', (_store, stores) => {
      const recorded = getDecoratorConfig(decorate(stores));

      expect(recorded).toMatchObject(stores);
      expect(recorded).toMatchObject({ serve: true, providers: [] });
    });

    it('keeps the store settings it was given, for the build to see which stores the server uses', () => {
      const stores = {
        redis: { provider: 'vercel-kv', url: 'https://kv.example.com', token: unset },
        jobs: { enabled: true, store: { sqlite: { path: sqlitePath } } },
        tasks: { enabled: true, redis: { url: unset }, sqlite: { path: sqlitePath } },
        throttle: { enabled: true, storage: { type: 'redis', redis: { url: unset } } },
      };

      expect(getDecoratorConfig(decorate(stores))).toMatchObject(stores);
    });

    it('validates the rest of the config', () => {
      expect(() => decorate({ redis: { url: unset }, http: { port: 'nope' } })).toThrow(InvalidDecoratorMetadataError);
    });
  });

  it.each(unsetStores)('refuses an unset %s when the generated CLI loads the server', (_store, stores) => {
    process.env[SCHEMA_EXTRACT] = '1';

    expect(() => decorate(stores)).toThrow();
  });

  it.each(unsetStores)('refuses an unset %s when a server loads', (_store, stores) => {
    expect(() => decorate({ ...stores, serve: false })).toThrow();
  });
});
