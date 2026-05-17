/**
 * Tests for the SQLite branch added to createElicitationStore (issue #401).
 * Mocks @frontmcp/storage-sqlite so we don't pull in better-sqlite3.
 */

import { createElicitationStore } from '../elicitation-store.factory';

const fakeStore = { kind: 'sqlite-elicit-mock' };
const SqliteElicitationStoreCtor = jest.fn().mockImplementation(() => fakeStore);

jest.mock(
  '@frontmcp/storage-sqlite',
  () => ({
    SqliteElicitationStore: SqliteElicitationStoreCtor,
  }),
  { virtual: true },
);

describe('createElicitationStore — SQLite branch (issue #401)', () => {
  beforeEach(() => {
    SqliteElicitationStoreCtor.mockClear();
  });

  it('routes { sqlite: ... } to createSqliteElicitationStore', async () => {
    const { store, type } = await createElicitationStore({
      sqlite: { path: '/tmp/elicit.sqlite' },
    });
    expect(store).toBe(fakeStore);
    expect(type).toBe('sqlite');
    expect(SqliteElicitationStoreCtor).toHaveBeenCalledTimes(1);
  });

  it('forwards keyPrefix into the SQLite store options', async () => {
    await createElicitationStore({
      sqlite: { path: '/tmp/elicit.sqlite' },
      keyPrefix: 'mcp:elicit:',
    });
    expect(SqliteElicitationStoreCtor).toHaveBeenCalledWith({
      path: '/tmp/elicit.sqlite',
      keyPrefix: 'mcp:elicit:',
    });
  });

  it('throws on Edge runtime with SQLite (better-sqlite3 is native)', async () => {
    await expect(
      createElicitationStore({
        sqlite: { path: '/tmp/x.sqlite' },
        isEdgeRuntime: true,
      }),
    ).rejects.toThrow(/Edge runtime/);
  });

  it('returns supportsPubSub:true in the log (the store handles in-process pub/sub)', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never;
    await createElicitationStore({
      sqlite: { path: '/tmp/elicit.sqlite' },
      logger,
    });
    expect((logger as { info: jest.Mock }).info).toHaveBeenCalledWith(
      '[ElicitationStoreFactory] Created elicitation store',
      expect.objectContaining({ type: 'sqlite', supportsPubSub: true }),
    );
  });
});
