/**
 * A browser has no TCP socket for Redis and no file for SQLite: in a browser, startup refuses an ApprovalPlugin `storage`
 * on either before it opens, in the server's one BrowserStoreUnavailableError, naming `storage: { type: 'memory' }`
 * (#1033).
 */
import 'reflect-metadata';

import { App, BrowserStoreUnavailableError, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';
import { createMemoryStorage, getRuntimeContext, type RuntimeContext, type StorageConfig } from '@frontmcp/utils';

import type { ApprovalPluginOptions } from '../approval.plugin';
import { ApprovalPlugin } from '../index';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const redisStorage: StorageConfig = { type: 'redis', redis: { url: 'redis://127.0.0.1:6379' } };
const sqliteStorage: StorageConfig = { type: 'sqlite', sqlite: { path: '/var/lib/app/approvals.sqlite' } };

async function startWith(options: ApprovalPluginOptions): Promise<void> {
  @App({ id: 'approving', name: 'Approving', plugins: [ApprovalPlugin.init(options)] })
  class ApprovingApp {}

  const server = await FrontMcpInstance.createDirect({
    info: { name: 'approval-browser-store', version: '1.0.0' },
    apps: [ApprovingApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false },
  });
  await server.dispose();
}

afterEach(() => runtimeContext.mockImplementation(realRuntimeContext));

describe('ApprovalPlugin in a browser', () => {
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
    expect(() => ApprovalPlugin.init({ storage })).not.toThrow();

    const startup = startWith({ storage });
    await expect(startup).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(startup).rejects.toMatchObject({
      stores: [['ApprovalPlugin', option]],
      message: `A browser cannot open Redis or SQLite: ApprovalPlugin would use ${option} (set storage: { type: 'memory' } in place of ${option})`,
    });
  });

  it('keeps a memory, an auto-detected or a Vercel KV storage, and a storage instance given in place of storage', () => {
    const declared = (options: ApprovalPluginOptions) =>
      ApprovalPlugin.browserStores(options).map(({ option }) => option);

    expect(declared({})).toEqual([undefined]);
    expect(declared({ storage: redisStorage, storageInstance: createMemoryStorage() })).toEqual([undefined]);
    expect(declared({ storage: { type: 'memory' } })).toEqual([undefined]);
    expect(declared({ storage: { type: 'vercel-kv' } })).toEqual([undefined]);
  });
});

describe('ApprovalPlugin on Node', () => {
  it('keeps a Redis or SQLite storage', () => {
    expect(() => ApprovalPlugin.init({ storage: redisStorage })).not.toThrow();
    expect(() => ApprovalPlugin.init({ storage: sqliteStorage })).not.toThrow();
  });
});
