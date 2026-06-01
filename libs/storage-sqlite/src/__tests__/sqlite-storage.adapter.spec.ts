import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
