/**
 * `tasks.store: false`, `elicitation.store: false` and `jobs.store: false` keep that state in memory although the
 * server has a top-level `sqlite`; in a browser, a store that would open Redis or SQLite fails startup before any
 * store opens.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { fileExists, getRuntimeContext, MemoryStorageAdapter, rm, type RuntimeContext } from '@frontmcp/utils';

import { App } from '../../common/decorators/app.decorator';
import { BrowserStoreUnavailableError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const sqliteTaskStore = jest.fn().mockImplementation(() => ({ close: jest.fn() }));
const sqliteElicitationStore = jest.fn().mockImplementation(() => ({}));
const sqliteStorageAdapter = jest.fn().mockImplementation(() => new MemoryStorageAdapter());
jest.mock('@frontmcp/storage-sqlite', () => ({
  SqliteTaskStore: sqliteTaskStore,
  SqliteElicitationStore: sqliteElicitationStore,
  SqliteStorageAdapter: sqliteStorageAdapter,
}));

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

@App({ id: 'store-off', name: 'store-off' })
class StoreOffApp {}

const sqlite = { path: path.join(os.tmpdir(), `frontmcp-store-off-${process.pid}`, 'state.sqlite') };
const redis = { provider: 'redis' as const, host: '127.0.0.1', port: 1 };

interface ScopeBackends {
  taskBackendType?: string;
  elicitationBackendType?: string;
  dispose(): Promise<void>;
}

const started: FrontMcpInstance[] = [];

async function startGraph(options: Record<string, unknown>): Promise<ScopeBackends> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'store-off', version: '0.0.0' },
    apps: [StoreOffApp],
    transport: { persistence: false },
    sqlite,
    ...options,
  });
  started.push(instance);
  return instance.getScopes()[0] as unknown as ScopeBackends;
}

describe('store: false with a top-level sqlite', () => {
  afterEach(async () => {
    await Promise.all(started.splice(0).map((instance) => instance.shutdown()));
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await rm(path.dirname(sqlite.path), { recursive: true, force: true });
  });

  it('keeps tasks in memory with tasks.store: false, where they would take the sqlite otherwise', async () => {
    expect((await startGraph({})).taskBackendType).toBe('sqlite');
    expect(sqliteTaskStore).toHaveBeenCalledTimes(1);

    expect((await startGraph({ tasks: { store: false } })).taskBackendType).toBe('memory');
    expect(sqliteTaskStore).toHaveBeenCalledTimes(1);
  });

  it('keeps elicitation in memory with elicitation.store: false, where it would take the sqlite otherwise', async () => {
    expect((await startGraph({ elicitation: { enabled: true } })).elicitationBackendType).toBe('sqlite');

    expect((await startGraph({ elicitation: { enabled: true, store: false } })).elicitationBackendType).toBe('memory');
  });

  it('keeps jobs in memory with jobs.store: false, where they would take the sqlite otherwise', async () => {
    await startGraph({ tasks: { enabled: false }, jobs: { enabled: true } });
    expect(sqliteStorageAdapter).toHaveBeenCalled();
    sqliteStorageAdapter.mockClear();

    await startGraph({ tasks: { enabled: false }, jobs: { enabled: true, store: false } });
    expect(sqliteStorageAdapter).not.toHaveBeenCalled();
  });

  it('refuses the cli task runner with tasks.store: false, which no detached worker can read', async () => {
    await expect(startGraph({ tasks: { store: false, runner: 'cli' } })).rejects.toThrow(
      'a top-level `sqlite` without `tasks.store: false`',
    );
  });
});

describe('stores in a browser', () => {
  const browserSqliteDir = path.join(os.tmpdir(), `frontmcp-browser-stores-${process.pid}`);
  const browserSqlite = { path: path.join(browserSqliteDir, 'state.sqlite') };

  beforeEach(() => {
    runtimeContext.mockImplementation(() => ({
      ...realRuntimeContext(),
      runtime: 'browser',
      deployment: 'standalone',
    }));
  });

  afterEach(async () => {
    runtimeContext.mockImplementation(realRuntimeContext);
    await Promise.all(started.splice(0).map((instance) => instance.shutdown()));
    jest.clearAllMocks();
  });

  async function createDirect(options: Record<string, unknown>) {
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'browser-stores', version: '0.0.0' },
      apps: [StoreOffApp],
      ...options,
    });
    await server.dispose();
  }

  async function expectNoSqliteTouched(): Promise<void> {
    expect(sqliteTaskStore).not.toHaveBeenCalled();
    expect(sqliteElicitationStore).not.toHaveBeenCalled();
    expect(sqliteStorageAdapter).not.toHaveBeenCalled();
    expect(await fileExists(browserSqliteDir)).toBe(false);
  }

  it('fails startup, before any store opens, when a store would take the top-level redis or sqlite', async () => {
    const startup = createDirect({ redis, sqlite: browserSqlite, elicitation: { enabled: true } });

    await expect(startup).rejects.toBeInstanceOf(BrowserStoreUnavailableError);
    await expect(startup).rejects.toMatchObject({
      stores: [
        ['tasks', 'redis'],
        ['elicitation', 'redis'],
      ],
    });
    await expectNoSqliteTouched();
  });

  it('fails startup when jobs would keep their runs in the top-level sqlite', async () => {
    await expect(
      createDirect({ sqlite: browserSqlite, tasks: { store: false }, jobs: { enabled: true } }),
    ).rejects.toMatchObject({ code: 'BROWSER_STORE_UNAVAILABLE', stores: [['jobs', 'sqlite']] });
    await expectNoSqliteTouched();
  });

  it('fails startup when persistent questions would keep their default SQLite file, and starts with a memory storage', async () => {
    const elicitation = { enabled: true, store: false };

    await expect(createDirect({ elicitation: { ...elicitation, persistent: true } })).rejects.toMatchObject({
      stores: [['questions', 'the default questions.sqlite file']],
    });
    await expect(
      createDirect({ elicitation: { ...elicitation, persistent: { storage: { type: 'memory' } } } }),
    ).resolves.toBeUndefined();
  });

  it('starts in memory when every store is switched off, with the top-level redis and sqlite left in', async () => {
    const warn = jest.spyOn(console, 'warn');

    await expect(
      createDirect({
        redis,
        sqlite: browserSqlite,
        tasks: { store: false },
        elicitation: { enabled: true, store: false },
        jobs: { enabled: true, store: false },
      }),
    ).resolves.toBeUndefined();
    await expectNoSqliteTouched();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('no subsystem consumes it');
    warn.mockRestore();
  });
});
