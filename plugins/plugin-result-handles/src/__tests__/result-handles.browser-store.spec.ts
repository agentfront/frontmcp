/**
 * A browser has no TCP socket for Redis and no file for SQLite: in a browser, startup refuses a ResultHandlesPlugin
 * `storage` on either before it opens, in the server's one BrowserStoreUnavailableError, naming
 * `storage: { type: 'memory' }` (#1033).
 */
import 'reflect-metadata';

import { App, BrowserStoreUnavailableError, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';
import { getRuntimeContext, type RuntimeContext, type StorageConfig } from '@frontmcp/utils';

import { ResultHandlesPlugin, type ResultHandlesPluginOptionsInput } from '../index';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const redisStorage: StorageConfig = { type: 'redis', redis: { url: 'redis://127.0.0.1:6379' } };
const sqliteStorage: StorageConfig = { type: 'sqlite', sqlite: { path: '/var/lib/app/results.sqlite' } };

async function startWith(options: ResultHandlesPluginOptionsInput): Promise<void> {
  @App({ id: 'folding', name: 'Folding', plugins: [ResultHandlesPlugin.init(options)] })
  class FoldingApp {}

  const server = await FrontMcpInstance.createDirect({
    info: { name: 'result-handles-browser-store', version: '1.0.0' },
    apps: [FoldingApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false },
  });
  await server.dispose();
}

afterEach(() => runtimeContext.mockImplementation(realRuntimeContext));

describe('ResultHandlesPlugin in a browser', () => {
  beforeEach(() => {
    runtimeContext.mockImplementation(() => ({
      ...realRuntimeContext(),
      runtime: 'browser',
      deployment: 'standalone',
    }));
  });

  it.each([
    ["storage: { type: 'redis' }", redisStorage],
    ["storage: { type: 'sqlite' }", sqliteStorage],
  ])('refuses %s at startup, naming the memory storage', async (option, storage) => {
    expect(() => ResultHandlesPlugin.init({ storage })).not.toThrow();

    const startup = startWith({ storage });
    await expect(startup).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(startup).rejects.toMatchObject({
      stores: [['ResultHandlesPlugin', option]],
      message: `A browser cannot open Redis or SQLite: ResultHandlesPlugin would use ${option} (set storage: { type: 'memory' } in place of ${option})`,
    });
  });

  it('keeps a memory, an auto-detected or a Vercel KV storage', () => {
    const declared = (options: ResultHandlesPluginOptionsInput) =>
      ResultHandlesPlugin.browserStores(options).map(({ option }) => option);

    expect(declared({})).toEqual([undefined]);
    expect(declared({ storage: { type: 'memory' } })).toEqual([undefined]);
    expect(declared({ storage: { type: 'vercel-kv' } })).toEqual([undefined]);
  });
});

describe('ResultHandlesPlugin on Node', () => {
  it('keeps a Redis or SQLite storage', () => {
    expect(() => ResultHandlesPlugin.init({ storage: redisStorage })).not.toThrow();
    expect(() => ResultHandlesPlugin.init({ storage: sqliteStorage })).not.toThrow();
  });
});
