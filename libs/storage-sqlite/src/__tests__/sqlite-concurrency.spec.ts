/**
 * Two processes on one database file (#646): a second process opening the store
 * while another holds the write lock must wait for it (busy_timeout) rather than
 * fail with SQLITE_BUSY during the WAL switch / DDL.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { openDatabase, withBusyRetry } from '../open-database';
import { SqliteKvStore } from '../sqlite-kv.store';

const HOLD_MS = 700;

function holdWriteLock(dbPath: string): Promise<{ done: Promise<void>; lockedAt: number }> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
      const Database = require(process.env.BSQ3);
      const db = new Database(process.env.DB);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)');
      db.exec('BEGIN IMMEDIATE');
      db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('held', 'x')").run();
      process.stdout.write('locked ' + Date.now() + '\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});
      db.exec('COMMIT');
      db.close();
      `,
    ],
    {
      env: { ...process.env, BSQ3: require.resolve('better-sqlite3'), DB: dbPath },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const done = new Promise<void>((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}`))));
    child.on('error', reject);
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      const match = /locked (\d+)/.exec(chunk.toString());
      if (match) resolve({ done, lockedAt: Number(match[1]) });
    });
    done.catch(reject);
  });
}

describe('SQLite multi-process access (#646)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-conc-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('waits for another process holding the write lock instead of throwing SQLITE_BUSY', async () => {
    const dbPath = path.join(dir, 'shared.sqlite');
    const holder = await holdWriteLock(dbPath);

    const store = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: true });
    try {
      store.set('mine', 'y');
      // Measured from when the child took the lock, so a slow parent cannot skew it
      expect(Date.now() - holder.lockedAt).toBeGreaterThanOrEqual(HOLD_MS / 2);
      expect(store.get('mine')).toBe('y');
    } finally {
      store.close();
    }
    await holder.done;
  }, 20_000);

  it('sets busy_timeout on every opened database', () => {
    const db = openDatabase(path.join(dir, 'a.sqlite'), 'TestStore', { busyTimeoutMs: 1234 });
    try {
      expect(db.pragma('busy_timeout', { simple: true })).toBe(1234);
    } finally {
      db.close();
    }
  });

  it('defaults busy_timeout to 5s', () => {
    const db = openDatabase(':memory:', 'TestStore');
    try {
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe('withBusyRetry', () => {
  const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

  it('retries SQLITE_BUSY until the operation succeeds', () => {
    let calls = 0;
    const result = withBusyRetry(
      () => {
        if (++calls < 3) throw busy();
        return 'ok';
      },
      { attempts: 5, delayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after the configured attempts and rethrows the busy error', () => {
    let calls = 0;
    expect(() =>
      withBusyRetry(
        () => {
          calls++;
          throw busy();
        },
        { attempts: 3, delayMs: 1 },
      ),
    ).toThrow('database is locked');
    expect(calls).toBe(3);
  });

  it('does not retry other errors', () => {
    let calls = 0;
    expect(() =>
      withBusyRetry(
        () => {
          calls++;
          throw new Error('syntax error');
        },
        { attempts: 5, delayMs: 1 },
      ),
    ).toThrow('syntax error');
    expect(calls).toBe(1);
  });
});
