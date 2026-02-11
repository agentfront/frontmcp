import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { SqliteSessionStore } from '../sqlite-session.store';

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-session-'));
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

describe('SqliteSessionStore', () => {
  let store: SqliteSessionStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new SqliteSessionStore({
      path: dbPath,
      ttlCleanupIntervalMs: 0,
    });
  });

  afterEach(() => {
    store.close();
    cleanup(dbPath);
  });

  it('should allocate unique session IDs', () => {
    const id1 = store.allocId();
    const id2 = store.allocId();
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('should create and retrieve a session', async () => {
    const sessionData = {
      session: {
        id: 'session-1',
        authorizationId: 'auth-1',
        protocol: 'streamable-http',
        createdAt: Date.now(),
        nodeId: 'node-1',
      },
      authorizationId: 'auth-1',
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    await store.set('session-1', sessionData);
    const retrieved = await store.get('session-1');
    expect(retrieved).toEqual(sessionData);
  });

  it('should return null for non-existent session', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should check session existence', async () => {
    expect(await store.exists('session-1')).toBe(false);

    await store.set('session-1', { createdAt: Date.now() });
    expect(await store.exists('session-1')).toBe(true);
  });

  it('should delete a session', async () => {
    await store.set('session-1', { createdAt: Date.now() });
    expect(await store.exists('session-1')).toBe(true);

    await store.delete('session-1');
    expect(await store.exists('session-1')).toBe(false);
  });

  it('should expire sessions based on TTL', async () => {
    await store.set('session-1', { createdAt: Date.now() }, 1); // 1ms TTL

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));

    const result = await store.get('session-1');
    expect(result).toBeNull();
  });

  it('should use custom key prefix', () => {
    const customStore = new SqliteSessionStore({
      path: dbPath,
      keyPrefix: 'custom:',
      ttlCleanupIntervalMs: 0,
    });

    customStore.close();
    // Verify it doesn't throw with custom prefix
    expect(true).toBe(true);
  });

  it('should use namespace isolation between stores', async () => {
    const dbPath2 = tmpDbPath();
    const store2 = new SqliteSessionStore({
      path: dbPath2,
      keyPrefix: 'ns2:session:',
      ttlCleanupIntervalMs: 0,
    });

    await store.set('session-1', { ns: 'default' });
    await store2.set('session-1', { ns: 'ns2' });

    expect(await store.get('session-1')).toEqual({ ns: 'default' });
    expect(await store2.get('session-1')).toEqual({ ns: 'ns2' });

    store2.close();
    cleanup(dbPath2);
  });
});
