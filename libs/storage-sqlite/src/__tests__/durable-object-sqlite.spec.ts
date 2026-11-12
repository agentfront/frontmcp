import { StorageOperationError } from '@frontmcp/utils';

import {
  fakeDurableObjectStorage,
  INSTANCE_ENDED,
  PATTERN_REFUSED,
  PRAGMA_REFUSED,
  TRANSACTION_REFUSED,
  type FakeDurableObjectStorage,
} from '../__test-utils__/fake-durable-object-storage';
import { durableObjectSqlite } from '../durable-object-sqlite';
import { openDatabase } from '../open-database';
import { useSqliteDriver } from '../sqlite-driver';
import { SqliteSessionStore } from '../sqlite-session.store';
import { SqliteStorageAdapter } from '../sqlite-storage.adapter';

const DATABASE = 'durable-object.sqlite';
const LONG_PREFIX = `mcp:events:index:principal:${'f'.repeat(64)}:`;

describe('durableObjectSqlite', () => {
  let storage: FakeDurableObjectStorage;

  beforeEach(() => {
    storage = fakeDurableObjectStorage();
    useSqliteDriver(durableObjectSqlite(storage));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    useSqliteDriver(undefined);
  });

  async function connectedAdapter(): Promise<SqliteStorageAdapter> {
    const adapter = new SqliteStorageAdapter({ path: DATABASE, ttlCleanupIntervalMs: 0 });
    await adapter.connect();
    return adapter;
  }

  /** Moves the clock, which the stores read with `Date.now()`. */
  function passTime(milliseconds: number): void {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + milliseconds);
  }

  describe('the fake storage', () => {
    it.each([
      ['BEGIN', 'BEGIN IMMEDIATE', [], TRANSACTION_REFUSED],
      ['PRAGMA busy_timeout', 'PRAGMA busy_timeout = 5000', [], PRAGMA_REFUSED],
      ['PRAGMA journal_mode', 'PRAGMA journal_mode = WAL', [], PRAGMA_REFUSED],
      ['a LIKE pattern over 50 bytes', "SELECT 'key' LIKE ?", [`${LONG_PREFIX}%`], PATTERN_REFUSED],
    ])('refuses %s, as a Durable Object does', (_name, query, bindings, message) => {
      expect(() => storage.sql.exec(query, ...bindings)).toThrow(message);
    });
  });

  describe("the driver's database", () => {
    it('answers the pragmas a Durable Object refuses without a query, and passes on the others', () => {
      const database = openDatabase(DATABASE, 'Test', { walMode: true });

      expect(database.pragma('busy_timeout', { simple: true })).toBe(0);
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(storage.queries).toEqual([]);
      expect(database.pragma('data_version', { simple: true })).toEqual(expect.any(Number));
      expect(database.pragma('data_version')).toEqual([{ data_version: expect.any(Number) }]);
    });

    it('runs a transaction with transactionSync(), and rolls it back when the operation throws', () => {
      const database = openDatabase(DATABASE, 'Test');
      database.exec('CREATE TABLE notes (body TEXT)');
      const insert = database.prepare('INSERT INTO notes (body) VALUES (?)');

      const kept = database.transaction(() => insert.run('kept').changes).immediate();
      const failing = database.transaction(() => {
        insert.run('rolled back');
        throw new Error('boom');
      });

      expect(kept).toBe(1);
      expect(() => failing.immediate()).toThrow('boom');
      expect(database.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'kept' }]);
      expect(storage.queries.filter((query) => /BEGIN|COMMIT|ROLLBACK/i.test(query))).toEqual([]);
    });

    it('reports how many rows a statement changed, and the first row or none', () => {
      const database = openDatabase(DATABASE, 'Test');
      database.exec('CREATE TABLE notes (body TEXT, read INTEGER); CREATE INDEX notes_read ON notes (read)');
      const insert = database.prepare('INSERT INTO notes (body, read) VALUES (?, 0)');
      insert.run('first');
      insert.run('second');

      expect(database.prepare('UPDATE notes SET read = 1').run()).toEqual({ changes: 2 });
      expect(database.prepare('DELETE FROM notes WHERE body = ?').run('missing')).toEqual({ changes: 0 });
      expect(database.prepare('SELECT body FROM notes ORDER BY body').get()).toEqual({ body: 'first' });
      expect(database.prepare('SELECT body FROM notes WHERE body = ?').get('missing')).toBeUndefined();
    });

    it('is closed once close() is called, on its own', () => {
      const first = openDatabase(DATABASE, 'Test');
      const second = openDatabase('another.sqlite', 'Test');
      first.exec('CREATE TABLE notes (body TEXT)');

      first.close();

      expect(first.open).toBe(false);
      expect(second.open).toBe(true);
      expect(second.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({ count: 0 });
    });
  });

  describe('SqliteStorageAdapter', () => {
    let adapter: SqliteStorageAdapter;

    beforeEach(async () => {
      adapter = await connectedAdapter();
    });

    afterEach(() => adapter.disconnect());

    it('sets, gets and deletes a value', async () => {
      await adapter.set('k', 'v');

      expect(await adapter.get('k')).toBe('v');
      expect(await adapter.exists('k')).toBe(true);
      expect(await adapter.ping()).toBe(true);
      expect(await adapter.delete('k')).toBe(true);
      expect(await adapter.delete('k')).toBe(false);
      expect(await adapter.get('k')).toBeNull();
    });

    it('sets a value only under its condition', async () => {
      await adapter.set('k', 'first', { ifNotExists: true });
      await adapter.set('k', 'second', { ifNotExists: true });
      await adapter.set('missing', 'v', { ifExists: true });

      expect(await adapter.get('k')).toBe('first');
      expect(await adapter.get('missing')).toBeNull();
      expect(await adapter.setIfEquals('k', 'first', 'third')).toBe(true);
      expect(await adapter.setIfEquals('k', 'first', 'fourth')).toBe(false);
      expect(await adapter.deleteIfEquals('k', 'first')).toBe(false);
      expect(await adapter.deleteIfEquals('k', 'third')).toBe(true);
    });

    it('expires a value', async () => {
      await adapter.set('short', 'v', { ttlSeconds: 10 });
      await adapter.set('kept', 'v');
      expect(await adapter.ttl('short')).toBe(10);
      expect(await adapter.expire('kept', 60)).toBe(true);
      expect(await adapter.expire('missing', 60)).toBe(false);

      passTime(11_000);

      expect(await adapter.get('short')).toBeNull();
      expect(await adapter.ttl('short')).toBeNull();
      expect(await adapter.keys('*')).toEqual(['kept']);
      expect(adapter.getKvStore().purgeExpired()).toBe(0);
      passTime(61_000);
      expect(adapter.getKvStore().purgeExpired()).toBe(1);
    });

    it('searches keys by a prefix over 50 bytes, and by a wildcard in the middle', async () => {
      await adapter.mset(
        [`${LONG_PREFIX}sub_1`, `${LONG_PREFIX}sub_2`, `${LONG_PREFIX}old:sub_3`, 'mcp:events:other'].map((key) => ({
          key,
          value: '1',
        })),
      );

      expect((await adapter.keys(`${LONG_PREFIX}*`)).sort()).toEqual(
        [`${LONG_PREFIX}old:sub_3`, `${LONG_PREFIX}sub_1`, `${LONG_PREFIX}sub_2`].sort(),
      );
      expect(await adapter.keys(`${LONG_PREFIX}*:sub_?`)).toEqual([`${LONG_PREFIX}old:sub_3`]);
      expect(await adapter.keys('*:other')).toEqual(['mcp:events:other']);
      expect(storage.queries.filter((query) => /\bLIKE\b/i.test(query))).toEqual([]);
    });

    it('increments a counter, and keeps its expiry', async () => {
      expect(await adapter.incr('counter')).toBe(1);
      expect(await adapter.incrBy('counter', 4)).toBe(5);
      expect(await adapter.decr('counter')).toBe(4);

      await adapter.expire('counter', 30);
      expect(await adapter.incr('counter')).toBe(5);
      expect(await adapter.ttl('counter')).toBe(30);

      await adapter.set('text', 'not a number');
      await expect(adapter.incr('text')).rejects.toThrow(StorageOperationError);
      expect(await adapter.get('text')).toBe('not a number');
    });

    it('reads the data version', async () => {
      expect(await adapter.dataVersion()).toEqual(expect.any(Number));
    });
  });

  describe('SqliteSessionStore', () => {
    it('stores a session until it expires or is deleted, next to the other stores', async () => {
      const sessions = new SqliteSessionStore({ path: DATABASE, ttlCleanupIntervalMs: 0 });
      const adapter = await connectedAdapter();
      const sessionId = sessions.allocId();

      await sessions.set(sessionId, { userId: 'ada' }, 60_000);
      await sessions.set('short', { userId: 'grace' }, 1_000);

      expect(await sessions.get(sessionId)).toEqual({ userId: 'ada' });
      expect(await sessions.exists(sessionId)).toBe(true);
      expect((await adapter.keys('mcp:session:*')).sort()).toEqual(
        [`mcp:session:${sessionId}`, 'mcp:session:short'].sort(),
      );

      passTime(2_000);
      expect(await sessions.get('short')).toBeNull();
      await sessions.delete(sessionId);
      expect(await sessions.exists(sessionId)).toBe(false);

      sessions.close();
      await adapter.disconnect();
    });
  });

  it("gives the Durable Object's next instance, in the same isolate, a connection to its own storage", async () => {
    const earlier = await connectedAdapter();
    await earlier.set('k', 'kept across instances');

    useSqliteDriver(durableObjectSqlite(storage.nextInstance()));
    const current = await connectedAdapter();

    expect(await current.get('k')).toBe('kept across instances');
    expect(await current.incr('counter')).toBe(1);
    await expect(earlier.get('k')).rejects.toThrow(INSTANCE_ENDED);
    await earlier.disconnect();
    await current.disconnect();
  });
});
