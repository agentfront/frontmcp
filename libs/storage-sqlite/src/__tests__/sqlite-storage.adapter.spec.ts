import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type Database from 'better-sqlite3';

import { StorageOperationError, StorageTTLError } from '@frontmcp/utils';

import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { SqliteKvStore } from '../sqlite-kv.store';
import { SqliteStorageAdapter } from '../sqlite-storage.adapter';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-adapter-'));
  return path.join(dir, 'test.sqlite');
}

function cleanup(dbPath: string): void {
  try {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('SqliteStorageAdapter', () => {
  let adapter: SqliteStorageAdapter;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = tmpDbPath();
    adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0 });
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
    cleanup(dbPath);
  });

  /** A TTL that ran out between two sweeps: the row is still there, past its expiry. */
  function expireNow(key: string): void {
    adapter
      .getKvStore()
      .getDatabase()
      .prepare('UPDATE kv SET expires_at = ? WHERE key = ?')
      .run(Date.now() - 1, key);
  }

  describe('keys() LIKE escaping', () => {
    // The adapter escapes LIKE metacharacters as `\%` / `\_`; this only works
    // if SqliteKvStore's LIKE query declares `ESCAPE '\'`. These cases would
    // over-match (treating %/_ as wildcards) without the ESCAPE clause.
    it('treats a literal "%" in the pattern as a literal, not a wildcard', async () => {
      await adapter.set('a%b', '1');
      await adapter.set('axb', '2'); // would match if % were a wildcard
      await adapter.set('aXXb', '3'); // would match if % were a wildcard

      const matched = await adapter.keys('a%b');
      expect(matched).toEqual(['a%b']);
    });

    it('treats a literal "_" in the pattern as a literal, not a single-char wildcard', async () => {
      await adapter.set('a_b', '1');
      await adapter.set('axb', '2'); // would match if _ were a single-char wildcard
      await adapter.set('aQb', '3'); // would match if _ were a single-char wildcard

      const matched = await adapter.keys('a_b');
      expect(matched).toEqual(['a_b']);
    });

    it('still supports glob "*" → "%" and "?" → "_" translation', async () => {
      await adapter.set('session:1', 'a');
      await adapter.set('session:22', 'b');
      await adapter.set('cache:1', 'c');

      expect((await adapter.keys('session:*')).sort()).toEqual(['session:1', 'session:22']);
      // `?` matches exactly one character → only the single-digit key.
      expect(await adapter.keys('session:?')).toEqual(['session:1']);
    });

    it('returns all keys for the default "*" pattern', async () => {
      await adapter.set('k1', '1');
      await adapter.set('k2', '2');
      expect((await adapter.keys()).sort()).toEqual(['k1', 'k2']);
    });
  });

  describe('connect / ping', () => {
    it('ping returns false before connect and true after', async () => {
      const fresh = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      expect(await fresh.ping()).toBe(false);
      await fresh.connect();
      expect(await fresh.ping()).toBe(true);
      await fresh.disconnect();
    });

    it('ping returns false when the underlying handle throws', async () => {
      // After disconnect the owned store is closed, so has() throws → ping swallows it.
      const owned = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      await owned.connect();
      // Force the connected flag back on but close the handle to hit the catch branch.
      jest.spyOn(owned.getKvStore(), 'has').mockImplementation(() => {
        throw new Error('handle closed');
      });
      expect(await owned.ping()).toBe(false);
      await owned.disconnect();
    });

    it('connect is idempotent', async () => {
      await adapter.connect();
      await adapter.connect();
      expect(await adapter.ping()).toBe(true);
    });
  });

  describe('core operations round-trip', () => {
    it('set then get returns the stored value', async () => {
      await adapter.set('greeting', 'hello');
      expect(await adapter.get('greeting')).toBe('hello');
    });

    it('get returns null for a missing key', async () => {
      expect(await adapter.get('missing')).toBeNull();
    });

    it('exists reflects presence', async () => {
      expect(await adapter.exists('k')).toBe(false);
      await adapter.set('k', 'v');
      expect(await adapter.exists('k')).toBe(true);
    });

    it('delete returns true when the key existed and removes it', async () => {
      await adapter.set('k', 'v');
      expect(await adapter.delete('k')).toBe(true);
      expect(await adapter.get('k')).toBeNull();
    });

    it('delete returns false when the key did not exist', async () => {
      expect(await adapter.delete('nope')).toBe(false);
    });
  });

  describe('doSet conditional flags (NX / XX)', () => {
    it('ifNotExists does not overwrite an existing key', async () => {
      await adapter.set('k', 'first');
      await adapter.set('k', 'second', { ifNotExists: true });
      expect(await adapter.get('k')).toBe('first');
    });

    it('ifNotExists sets a missing key', async () => {
      await adapter.set('fresh', 'v', { ifNotExists: true });
      expect(await adapter.get('fresh')).toBe('v');
    });

    it('ifExists updates an existing key', async () => {
      await adapter.set('k', 'first');
      await adapter.set('k', 'second', { ifExists: true });
      expect(await adapter.get('k')).toBe('second');
    });

    it('ifExists is a no-op for a missing key', async () => {
      await adapter.set('ghost', 'v', { ifExists: true });
      expect(await adapter.get('ghost')).toBeNull();
    });

    it('rejects mutually-exclusive NX + XX (validated by BaseStorageAdapter.set)', async () => {
      await expect(adapter.set('k', 'v', { ifNotExists: true, ifExists: true })).rejects.toThrow(/mutually exclusive/);
    });
  });

  describe('TTL operations', () => {
    it('set with ttlSeconds yields a positive ttl()', async () => {
      await adapter.set('k', 'v', { ttlSeconds: 100 });
      const ttl = await adapter.ttl('k');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    });

    it('ttl() returns -1 for a key with no expiry', async () => {
      await adapter.set('k', 'v');
      expect(await adapter.ttl('k')).toBe(-1);
    });

    it('ttl() returns null for a missing key', async () => {
      expect(await adapter.ttl('missing')).toBeNull();
    });

    it('expire() sets a ttl on an existing key', async () => {
      await adapter.set('k', 'v');
      expect(await adapter.expire('k', 50)).toBe(true);
      const ttl = await adapter.ttl('k');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(50);
    });

    it('expire() returns false for a missing key', async () => {
      expect(await adapter.expire('missing', 50)).toBe(false);
    });

    it('an expired key reads back as null / absent', async () => {
      await adapter.set('k', 'v', { ttlSeconds: 1 });
      // Force expiry by rewinding the stored expires_at via the KV store directly.
      adapter.getKvStore().expire('k', -1000);
      expect(await adapter.get('k')).toBeNull();
      expect(await adapter.exists('k')).toBe(false);
      expect(await adapter.ttl('k')).toBeNull();
    });

    it('expire() returns false for a key whose TTL ran out', async () => {
      await adapter.set('k', 'v', { ttlSeconds: 1 });
      expireNow('k');
      expect(await adapter.expire('k', 50)).toBe(false);
    });

    it('expire() rejects a TTL that is not a positive integer', async () => {
      await adapter.set('k', 'v');
      await expect(adapter.expire('k', 0)).rejects.toBeInstanceOf(StorageTTLError);
      await expect(adapter.expire('k', 1.5)).rejects.toBeInstanceOf(StorageTTLError);
    });

    it('ifNotExists sets a key whose TTL ran out', async () => {
      await adapter.set('k', 'old', { ttlSeconds: 1 });
      expireNow('k');
      await adapter.set('k', 'new', { ifNotExists: true });
      expect(await adapter.get('k')).toBe('new');
    });
  });

  describe('compare-and-act', () => {
    it('deleteIfEquals deletes the key only while it holds the value', async () => {
      await adapter.set('lease', 'mine');
      expect(await adapter.deleteIfEquals('lease', 'theirs')).toBe(false);
      expect(await adapter.get('lease')).toBe('mine');
      expect(await adapter.deleteIfEquals('lease', 'mine')).toBe(true);
      expect(await adapter.exists('lease')).toBe(false);
    });

    it('deleteIfEquals returns false for a missing or expired key', async () => {
      expect(await adapter.deleteIfEquals('missing', 'x')).toBe(false);
      await adapter.set('lease', 'mine', { ttlSeconds: 1 });
      expireNow('lease');
      expect(await adapter.deleteIfEquals('lease', 'mine')).toBe(false);
    });

    it('expireIfEquals sets the TTL only while the key holds the value', async () => {
      await adapter.set('lease', 'mine', { ttlSeconds: 10 });
      expect(await adapter.expireIfEquals('lease', 'theirs', 100)).toBe(false);
      expect(await adapter.ttl('lease')).toBeLessThanOrEqual(10);
      expect(await adapter.expireIfEquals('lease', 'mine', 100)).toBe(true);
      expect(await adapter.ttl('lease')).toBeGreaterThan(10);
    });

    it('expireIfEquals returns false for a missing or expired key', async () => {
      expect(await adapter.expireIfEquals('missing', 'x', 10)).toBe(false);
      await adapter.set('lease', 'mine', { ttlSeconds: 1 });
      expireNow('lease');
      expect(await adapter.expireIfEquals('lease', 'mine', 10)).toBe(false);
    });

    it('expireIfEquals rejects a TTL that is not a positive integer', async () => {
      await adapter.set('lease', 'mine');
      await expect(adapter.expireIfEquals('lease', 'mine', -1)).rejects.toBeInstanceOf(StorageTTLError);
    });

    it('compares against the decrypted value when values are encrypted', async () => {
      const encryptedPath = tmpDbPath();
      const encrypted = new SqliteStorageAdapter({
        path: encryptedPath,
        ttlCleanupIntervalMs: 0,
        encryption: { secret: 'a-secret-that-is-long-enough-for-tests' },
      });
      await encrypted.connect();
      try {
        await encrypted.set('lease', 'mine', { ttlSeconds: 10 });
        expect(await encrypted.expireIfEquals('lease', 'mine', 100)).toBe(true);
        expect(await encrypted.deleteIfEquals('lease', 'mine')).toBe(true);
        await encrypted.set('n', '41');
        expect(await encrypted.incr('n')).toBe(42);
      } finally {
        await encrypted.disconnect();
        cleanup(encryptedPath);
      }
    });
  });

  describe('atomic across connections', () => {
    let foreign: Database.Database;

    beforeEach(() => {
      foreign = new (loadBetterSqlite3())(dbPath);
      foreign.pragma('busy_timeout = 0');
    });

    afterEach(() => foreign.close());

    /** What another process sees when it writes the file between this operation's read and its write. */
    function foreignWriteDuringRead(read: 'get' | 'has'): { outcome?: string } {
      const seen: { outcome?: string } = {};
      const kv = adapter.getKvStore();
      const original = kv[read].bind(kv);
      jest.spyOn(kv, read).mockImplementationOnce((key: string) => {
        try {
          foreign.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('foreign', 'x')").run();
          seen.outcome = 'wrote';
        } catch (error) {
          seen.outcome = (error as { code?: string }).code;
        }
        return original(key) as never;
      });
      return seen;
    }

    it.each([
      ['incr', 'get', () => adapter.incr('n')],
      ['set with ifNotExists', 'has', () => adapter.set('k', 'v', { ifNotExists: true })],
      ['set with ifExists', 'has', () => adapter.set('k', 'v', { ifExists: true })],
      ['delete', 'has', () => adapter.delete('k')],
      ['deleteIfEquals', 'get', () => adapter.deleteIfEquals('k', 'v')],
      ['expireIfEquals', 'get', () => adapter.expireIfEquals('k', 'v', 10)],
    ] as const)('%s holds the write lock from its read to its write', async (_name, read, operation) => {
      const seen = foreignWriteDuringRead(read);
      await operation();
      expect(seen.outcome).toBe('SQLITE_BUSY');
    });
  });

  describe('atomic operations', () => {
    it('incr starts at 1 for a missing key', async () => {
      expect(await adapter.incr('counter')).toBe(1);
      expect(await adapter.incr('counter')).toBe(2);
    });

    it('decr goes negative from a missing key', async () => {
      expect(await adapter.decr('counter')).toBe(-1);
    });

    it('incrBy adds an arbitrary amount', async () => {
      await adapter.set('counter', '10');
      expect(await adapter.incrBy('counter', 5)).toBe(15);
      expect(await adapter.get('counter')).toBe('15');
    });

    it('throws when the existing value is not an integer', async () => {
      await adapter.set('counter', 'not-a-number');
      await expect(adapter.incr('counter')).rejects.toThrow(/is not an integer/);
      await expect(adapter.incr('counter')).rejects.toBeInstanceOf(StorageOperationError);
    });

    it('starts an expired counter over, without its old TTL', async () => {
      await adapter.set('counter', '7', { ttlSeconds: 1 });
      expireNow('counter');
      expect(await adapter.incr('counter')).toBe(1);
      expect(await adapter.ttl('counter')).toBe(-1);
    });

    it('preserves an existing TTL across incr', async () => {
      await adapter.set('counter', '1', { ttlSeconds: 100 });
      await adapter.incr('counter');
      const ttl = await adapter.ttl('counter');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(100);
    });

    it('leaves a non-expiring counter without a TTL', async () => {
      await adapter.set('counter', '1');
      await adapter.incr('counter');
      expect(await adapter.ttl('counter')).toBe(-1);
    });
  });

  describe('batch operations (inherited from BaseStorageAdapter)', () => {
    it('mget / mset round-trip', async () => {
      await adapter.mset([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ]);
      expect(await adapter.mget(['a', 'b', 'missing'])).toEqual(['1', '2', null]);
    });

    it('mdelete returns the number of keys actually removed', async () => {
      await adapter.set('a', '1');
      await adapter.set('b', '2');
      expect(await adapter.mdelete(['a', 'b', 'missing'])).toBe(2);
    });

    it('count reflects the number of matching keys', async () => {
      await adapter.set('session:1', 'a');
      await adapter.set('session:2', 'b');
      await adapter.set('cache:1', 'c');
      expect(await adapter.count('session:*')).toBe(2);
      expect(await adapter.count()).toBe(3);
    });
  });

  describe('not-connected guards', () => {
    it('get throws StorageNotConnectedError before connect', async () => {
      const fresh = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      await expect(fresh.get('k')).rejects.toThrow();
      fresh.getKvStore().close();
    });

    it('keys throws before connect', async () => {
      const fresh = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      await expect(fresh.keys()).rejects.toThrow();
      fresh.getKvStore().close();
    });
  });

  describe('pub/sub', () => {
    it('does not support pub/sub and surfaces a SQLite-specific suggestion', async () => {
      expect(adapter.supportsPubSub()).toBe(false);
      await expect(adapter.publish('chan', 'msg')).rejects.toThrow(/Redis or Upstash/);
      await expect(adapter.subscribe('chan', () => undefined)).rejects.toThrow(/pub\/sub/);
    });
  });

  describe('constructor accepting an existing store', () => {
    it('wraps an injected SqliteKvStore and shares its data', async () => {
      const externalPath = tmpDbPath();
      const external = new SqliteKvStore({ path: externalPath, ttlCleanupIntervalMs: 0 });
      external.set('seed', 'value');

      const wrapping = new SqliteStorageAdapter(external);
      await wrapping.connect();

      expect(wrapping.getKvStore()).toBe(external);
      expect(await wrapping.get('seed')).toBe('value');

      await wrapping.disconnect();
      external.close();
      cleanup(externalPath);
    });
  });

  describe('disconnect() ownership', () => {
    it('closes the KV store it created', async () => {
      const owned = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      await owned.connect();
      const closeSpy = jest.spyOn(owned.getKvStore(), 'close');
      await owned.disconnect();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT close an externally-injected KV store', async () => {
      const externalPath = tmpDbPath();
      const external = new SqliteKvStore({ path: externalPath, ttlCleanupIntervalMs: 0 });
      const closeSpy = jest.spyOn(external, 'close');

      const wrapping = new SqliteStorageAdapter(external);
      await wrapping.connect();
      await wrapping.disconnect();

      // The injected store's lifecycle belongs to its owner, not the adapter.
      expect(closeSpy).not.toHaveBeenCalled();

      // Still usable after the adapter disconnected.
      external.set('k', 'v');
      expect(external.get('k')).toBe('v');

      external.close();
      cleanup(externalPath);
    });

    it('lets the operations already called finish before it closes the file', async () => {
      const pending = [adapter.incr('counter'), adapter.set('k', 'v'), adapter.get('k')];
      await adapter.disconnect();
      expect(await Promise.all(pending)).toEqual([1, undefined, 'v']);
      await expect(adapter.get('k')).rejects.toThrow(/not connected/i);
    });

    it('is idempotent (second disconnect is a no-op)', async () => {
      const owned = new SqliteStorageAdapter({ path: tmpDbPath(), ttlCleanupIntervalMs: 0 });
      await owned.connect();
      const closeSpy = jest.spyOn(owned.getKvStore(), 'close');
      await owned.disconnect();
      await owned.disconnect();
      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
