import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SqliteKvStore } from '../sqlite-kv.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-enc-'));
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

describe('SqliteKvStore with encryption', () => {
  let store: SqliteKvStore;
  let dbPath: string;
  const secret = 'test-encryption-secret-for-kv';

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteKvStore({
      path: dbPath,
      encryption: { secret },
      ttlCleanupIntervalMs: 0,
    });
  });

  afterEach(() => {
    store.close();
    cleanup(dbPath);
  });

  it('should encrypt values at rest', () => {
    store.set('key1', 'sensitive-data');

    // Read raw value from database to verify it's encrypted
    const db = store.getDatabase();
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('key1') as { value: string };
    expect(row.value).not.toBe('sensitive-data');
    expect(row.value).toContain(':'); // encrypted format: iv:tag:ciphertext
  });

  it('should decrypt values correctly on read', () => {
    store.set('key1', 'sensitive-data');
    expect(store.get('key1')).toBe('sensitive-data');
  });

  it('should encrypt/decrypt JSON values', () => {
    const data = { password: 'hunter2', token: 'abc123' };
    store.setJSON('secrets', data);
    expect(store.getJSON('secrets')).toEqual(data);
  });

  it('should not decrypt with different secret', () => {
    store.set('key1', 'sensitive-data');
    store.close();

    // Open with different secret
    const wrongStore = new SqliteKvStore({
      path: dbPath,
      encryption: { secret: 'wrong-secret' },
      ttlCleanupIntervalMs: 0,
    });

    expect(() => wrongStore.get('key1')).toThrow();
    wrongStore.close();
  });

  it('should store keys in plaintext', () => {
    store.set('my-key', 'my-value');

    // Read raw key from database to verify it's plaintext
    const db = store.getDatabase();
    const row = db.prepare('SELECT key FROM kv WHERE key = ?').get('my-key') as { key: string };
    expect(row.key).toBe('my-key');
  });
});
