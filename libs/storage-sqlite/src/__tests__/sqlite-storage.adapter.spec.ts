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
