/**
 * Tests for the SQLite branch added to `createSessionStore` (issue #401).
 * Mocks @frontmcp/storage-sqlite so unit tests don't pull in better-sqlite3.
 */

import { createSessionStore, createSqliteSessionStore } from '../session-store.factory';

const fakeSqliteStore = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  allocId: jest.fn(),
  close: jest.fn(),
};

const SqliteSessionStoreCtor = jest.fn().mockImplementation(() => fakeSqliteStore);

jest.mock(
  '@frontmcp/storage-sqlite',
  () => ({
    SqliteSessionStore: SqliteSessionStoreCtor,
  }),
  { virtual: true },
);

describe('createSessionStore — SQLite branch (issue #401)', () => {
  beforeEach(() => {
    SqliteSessionStoreCtor.mockClear();
  });

  it('routes { sqlite: ... } to the SQLite factory', async () => {
    const store = await createSessionStore({ sqlite: { path: '/tmp/x.sqlite' } });
    expect(store).toBe(fakeSqliteStore);
    expect(SqliteSessionStoreCtor).toHaveBeenCalledTimes(1);
  });

  it('forwards keyPrefix and defaultTtlMs onto the SQLite store options', async () => {
    await createSessionStore({
      sqlite: { path: '/tmp/y.sqlite' },
      keyPrefix: 'mcp:transport:',
      defaultTtlMs: 60000,
    });
    expect(SqliteSessionStoreCtor).toHaveBeenCalledWith({
      path: '/tmp/y.sqlite',
      keyPrefix: 'mcp:transport:',
      defaultTtlMs: 60000,
    });
  });

  it('logs at info level when a logger is passed', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never;
    await createSessionStore({ sqlite: { path: '/tmp/z.sqlite' } }, logger);
    expect((logger as { info: jest.Mock }).info).toHaveBeenCalledWith(
      '[SessionStoreFactory] Creating SQLite session store',
      { path: '/tmp/z.sqlite' },
    );
  });

  it('createSqliteSessionStore is also usable directly', () => {
    const store = createSqliteSessionStore({ path: '/tmp/direct.sqlite' });
    expect(store).toBe(fakeSqliteStore);
  });
});
