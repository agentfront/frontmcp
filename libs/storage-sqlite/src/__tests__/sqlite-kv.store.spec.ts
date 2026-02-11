import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SqliteKvStore } from '../sqlite-kv.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-kv-'));
  return path.join(dir, 'test.sqlite');
}

function cleanup(dbPath: string): void {
  try {
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe('SqliteKvStore', () => {
  let store: SqliteKvStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
  });

  afterEach(() => {
    store.close();
    cleanup(dbPath);
  });

  describe('basic CRUD', () => {
    it('should set and get a value', () => {
      store.set('key1', 'value1');
      expect(store.get('key1')).toBe('value1');
    });

    it('should return null for non-existent key', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('should overwrite existing value', () => {
      store.set('key1', 'value1');
      store.set('key1', 'value2');
      expect(store.get('key1')).toBe('value2');
    });

    it('should delete a key', () => {
      store.set('key1', 'value1');
      store.del('key1');
      expect(store.get('key1')).toBeNull();
    });

    it('should check if key exists', () => {
      expect(store.has('key1')).toBe(false);
      store.set('key1', 'value1');
      expect(store.has('key1')).toBe(true);
    });
  });

  describe('JSON operations', () => {
    it('should set and get JSON values', () => {
      const obj = { name: 'test', count: 42, nested: { active: true } };
      store.setJSON('json1', obj);
      expect(store.getJSON('json1')).toEqual(obj);
    });

    it('should return null for non-existent JSON key', () => {
      expect(store.getJSON('nonexistent')).toBeNull();
    });

    it('should return null for invalid JSON values', () => {
      // Directly store a non-JSON string
      store.set('invalid-json', 'not-json{');
      expect(store.getJSON('invalid-json')).toBeNull();
    });
  });

  describe('TTL', () => {
    it('should expire keys after TTL', () => {
      store.set('ttl1', 'value1', 1); // 1ms TTL

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      expect(store.get('ttl1')).toBeNull();
    });

    it('should not expire keys without TTL', () => {
      store.set('no-ttl', 'value1');
      expect(store.get('no-ttl')).toBe('value1');
    });

    it('should return TTL for a key', () => {
      store.set('ttl-key', 'value', 5000);
      const remaining = store.ttl('ttl-key');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(5000);
    });

    it('should return -1 for key without expiry', () => {
      store.set('no-exp', 'value');
      expect(store.ttl('no-exp')).toBe(-1);
    });

    it('should return -2 for non-existent key', () => {
      expect(store.ttl('nonexistent')).toBe(-2);
    });

    it('should set expiry on existing key', () => {
      store.set('expire-me', 'value');
      expect(store.ttl('expire-me')).toBe(-1);
      const result = store.expire('expire-me', 5000);
      expect(result).toBe(true);
      expect(store.ttl('expire-me')).toBeGreaterThan(0);
    });

    it('should return false when expiring non-existent key', () => {
      expect(store.expire('nonexistent', 5000)).toBe(false);
    });

    it('should purge expired keys', () => {
      store.set('exp1', 'v1', 1);
      store.set('exp2', 'v2', 1);
      store.set('keep', 'v3');

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const purged = store.purgeExpired();
      expect(purged).toBe(2);
      expect(store.has('keep')).toBe(true);
    });
  });

  describe('keys', () => {
    it('should list all keys', () => {
      store.set('a', '1');
      store.set('b', '2');
      store.set('c', '3');

      const keys = store.keys();
      expect(keys.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should filter keys by pattern', () => {
      store.set('session:1', 'a');
      store.set('session:2', 'b');
      store.set('cache:1', 'c');

      const keys = store.keys('session:%');
      expect(keys.sort()).toEqual(['session:1', 'session:2']);
    });

    it('should not include expired keys', () => {
      store.set('active', 'v1');
      store.set('expired', 'v2', 1);

      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const keys = store.keys();
      expect(keys).toEqual(['active']);
    });
  });

  describe('WAL mode', () => {
    it('should enable WAL mode by default', () => {
      const db = store.getDatabase();
      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0].journal_mode).toBe('wal');
    });

    it('should disable WAL mode when configured', () => {
      const noWalPath = tmpDbPath();
      const noWalStore = new SqliteKvStore({
        path: noWalPath,
        walMode: false,
        ttlCleanupIntervalMs: 0,
      });

      const db = noWalStore.getDatabase();
      const result = db.pragma('journal_mode') as { journal_mode: string }[];
      expect(result[0].journal_mode).not.toBe('wal');

      noWalStore.close();
      cleanup(noWalPath);
    });
  });
});
