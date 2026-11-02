import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type Database from 'better-sqlite3';

import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { acquireConnection } from '../sqlite-connection';
import { SqliteEventStore } from '../sqlite-event.store';
import { SqliteKvStore } from '../sqlite-kv.store';
import { SqliteStorageAdapter } from '../sqlite-storage.adapter';
import { SqliteTaskStore } from '../sqlite-task.store';

/** A second connection to the file, standing in for another process. */
function openForeignConnection(dbPath: string): Database.Database {
  const BetterSqlite3 = loadBetterSqlite3();
  const db = new BetterSqlite3(dbPath);
  db.pragma('busy_timeout = 0');
  return db;
}

function holdWriteLock(db: Database.Database, holdMs: number): Promise<void> {
  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('foreign', 'x')").run();
  return new Promise((resolve) =>
    setTimeout(() => {
      db.exec('COMMIT');
      resolve();
    }, holdMs),
  );
}

function countTicks(): { stop(): number } {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  return {
    stop() {
      clearInterval(timer);
      return ticks;
    },
  };
}

describe('shared SQLite connections', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-connection-')));
    dbPath = path.join(dir, 'shared.sqlite');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('gives every store on one file the same connection', async () => {
    const kv = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    const events = new SqliteEventStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    const tasks = new SqliteTaskStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    try {
      expect(events.getDatabase()).toBe(kv.getDatabase());
      expect(tasks.getDatabase()).toBe(kv.getDatabase());
    } finally {
      kv.close();
      events.close();
      await tasks.destroy();
    }
  });

  it('matches a relative path with the absolute path of the same file', () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const relative = new SqliteKvStore({ path: 'shared.sqlite', ttlCleanupIntervalMs: 0 });
      const absolute = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
      expect(absolute.getDatabase()).toBe(relative.getDatabase());
      relative.close();
      absolute.close();
    } finally {
      process.chdir(cwd);
    }
  });

  it('closes the connection when the last store on the file closes', () => {
    const first = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    const second = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    const db = first.getDatabase();

    first.close();
    first.close();
    expect(db.open).toBe(true);
    second.set('k', 'v');
    expect(second.get('k')).toBe('v');

    second.close();
    expect(db.open).toBe(false);
  });

  it('opens a fresh connection after the last one closed', () => {
    const first = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    first.set('k', 'v');
    first.close();

    const reopened = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    expect(reopened.get('k')).toBe('v');
    reopened.close();
  });

  it.each([
    ['SqliteKvStore', (dbPath: string) => new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: false })],
    [
      'SqliteEventStore',
      (dbPath: string) => new SqliteEventStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: false }),
    ],
    [
      'SqliteTaskStore',
      (dbPath: string) => new SqliteTaskStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: false }),
    ],
  ])('releases the connection when %s fails to set up the file', (_store, open) => {
    fs.writeFileSync(dbPath, 'not a SQLite database, and long enough for SQLite to read its header');
    expect(() => open(dbPath)).toThrow(expect.objectContaining({ code: 'SQLITE_NOTADB' }));

    fs.writeFileSync(dbPath, '');
    const kv = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    const db = kv.getDatabase();
    kv.close();
    expect(db.open).toBe(false);
  });

  it('opens a new connection when the shared one was closed directly', () => {
    const first = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    first.getDatabase().close();

    const second = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    second.set('k', 'v');
    first.close();
    const third = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    expect(third.getDatabase()).toBe(second.getDatabase());
    expect(third.get('k')).toBe('v');

    second.close();
    third.close();
    expect(third.getDatabase().open).toBe(false);
  });

  it('gives every in-memory store a database of its own', () => {
    const first = new SqliteKvStore({ path: ':memory:', ttlCleanupIntervalMs: 0 });
    const second = new SqliteKvStore({ path: ':memory:', ttlCleanupIntervalMs: 0 });
    first.set('k', 'v');
    expect(second.getDatabase()).not.toBe(first.getDatabase());
    expect(second.get('k')).toBeNull();
    first.close();
    second.close();
  });

  it('switches the file to WAL when a later store asks for it', () => {
    const rollback = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: false });
    expect(rollback.getDatabase().pragma('journal_mode', { simple: true })).toBe('delete');

    const wal = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: true });
    expect(wal.getDatabase().pragma('journal_mode', { simple: true })).toBe('wal');
    rollback.close();
    wal.close();
  });

  it('keeps the longest busy timeout the stores on the file asked for', () => {
    const short = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, busyTimeoutMs: 100 });
    const long = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, busyTimeoutMs: 2000 });
    const shorter = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0, busyTimeoutMs: 50 });
    expect(short.getDatabase().pragma('busy_timeout', { simple: true })).toBe(2000);
    short.close();
    long.close();
    shorter.close();
  });

  describe('queued operations', () => {
    it('runs operations in the order they were called', async () => {
      const connection = acquireConnection(dbPath, 'Test');
      const order: string[] = [];
      try {
        await Promise.all([
          connection.write(() => order.push('first write')),
          connection.read(() => order.push('read')),
          connection.write(() => order.push('second write')),
        ]);
        expect(order).toEqual(['first write', 'read', 'second write']);
      } finally {
        connection.release();
      }
    });

    it('rolls a write back when it throws, and runs the next one', async () => {
      const kv = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
      const connection = kv.getConnection();
      try {
        const failed = connection.write(() => {
          kv.set('half', 'written');
          throw new Error('boom');
        });
        const next = connection.write(() => kv.set('next', 'written'));

        await expect(failed).rejects.toThrow('boom');
        await next;
        expect(kv.get('half')).toBeNull();
        expect(kv.get('next')).toBe('written');
      } finally {
        kv.close();
      }
    });

    it('does not retry an error other than SQLITE_BUSY', async () => {
      const connection = acquireConnection(dbPath, 'Test');
      let calls = 0;
      try {
        await expect(
          connection.write(() => {
            calls++;
            throw Object.assign(new Error('constraint failed'), { code: 'SQLITE_CONSTRAINT' });
          }),
        ).rejects.toThrow('constraint failed');
        expect(calls).toBe(1);
      } finally {
        connection.release();
      }
    });
  });

  it.each([
    ['get', (kv: SqliteKvStore) => kv.get('lock'), null],
    ['ttl', (kv: SqliteKvStore) => kv.ttl('lock'), -2],
  ] as const)(
    'keeps the value another process writes between %s reading an expired key and purging it',
    (statement, read, expired) => {
      const kv = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
      const foreign = openForeignConnection(dbPath);
      try {
        kv.set('lock', 'stale', -1);
        const statements = (kv as unknown as { stmts: Record<string, Database.Statement> }).stmts;
        const readRow = statements[statement];
        statements[statement] = {
          get: (key: string) => {
            const row = readRow.get(key);
            foreign.prepare("INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (?, 'fresh', NULL)").run(key);
            return row;
          },
        } as unknown as Database.Statement;

        expect(read(kv)).toBe(expired);

        expect(foreign.prepare('SELECT value FROM kv WHERE key = ?').get('lock')).toEqual({ value: 'fresh' });
      } finally {
        foreign.close();
        kv.close();
      }
    },
  );

  describe('a lock held by another process', () => {
    it('waits for it without blocking the event loop', async () => {
      const adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0 });
      await adapter.connect();
      const foreign = openForeignConnection(dbPath);
      try {
        const released = holdWriteLock(foreign, 300);
        const ticks = countTicks();
        const startedAt = Date.now();

        expect(await adapter.incr('counter')).toBe(1);

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
        expect(ticks.stop()).toBeGreaterThanOrEqual(10);
        await released;
        expect(adapter.getKvStore().getDatabase().pragma('busy_timeout', { simple: true })).toBe(5000);
      } finally {
        foreign.close();
        await adapter.disconnect();
      }
    });

    it('fails every queued operation within busyTimeoutMs of its call, not one timeout after another', async () => {
      const adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0, busyTimeoutMs: 100 });
      await adapter.connect();
      const foreign = openForeignConnection(dbPath);
      try {
        const released = holdWriteLock(foreign, 600);
        const startedAt = Date.now();

        const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => adapter.set(`k${i}`, 'v')));

        expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(5).fill('rejected'));
        expect(Date.now() - startedAt).toBeLessThan(300);
        await released;
      } finally {
        foreign.close();
        await adapter.disconnect();
      }
    });

    it.each([
      [
        'SqliteKvStore',
        (dbPath: string) => new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 10, busyTimeoutMs: 200 }),
      ],
      [
        'SqliteEventStore',
        (dbPath: string) => new SqliteEventStore({ path: dbPath, ttlCleanupIntervalMs: 10, busyTimeoutMs: 200 }),
      ],
    ])("runs %s's sweep of expired rows on the queue, so it neither blocks nor throws", async (_store, open) => {
      const store = open(dbPath);
      const kv = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
      kv.set('stale', 'v', 1);
      const foreign = openForeignConnection(dbPath);
      let longestGapMs = 0;
      let lastTickAt = Date.now();
      const timer = setInterval(() => {
        longestGapMs = Math.max(longestGapMs, Date.now() - lastTickAt);
        lastTickAt = Date.now();
      }, 5);
      try {
        await holdWriteLock(foreign, 400);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(longestGapMs).toBeLessThan(150);
        expect(kv.getDatabase().prepare("SELECT key FROM kv WHERE key = 'stale'").get()).toEqual(
          store instanceof SqliteKvStore ? undefined : { key: 'stale' },
        );
      } finally {
        clearInterval(timer);
        foreign.close();
        kv.close();
        store.close();
      }
    });

    it('gives up with SQLITE_BUSY once busyTimeoutMs has passed', async () => {
      const adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0, busyTimeoutMs: 150 });
      await adapter.connect();
      const foreign = openForeignConnection(dbPath);
      try {
        const released = holdWriteLock(foreign, 600);
        const ticks = countTicks();
        const startedAt = Date.now();

        await expect(adapter.set('k', 'v')).rejects.toMatchObject({ code: 'SQLITE_BUSY' });

        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140);
        expect(Date.now() - startedAt).toBeLessThan(550);
        expect(ticks.stop()).toBeGreaterThanOrEqual(5);
        await released;
        await adapter.set('k', 'v');
        expect(await adapter.get('k')).toBe('v');
      } finally {
        foreign.close();
        await adapter.disconnect();
      }
    });

    it('pings without blocking the event loop while a commit locks readers out', async () => {
      const adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0, walMode: false });
      await adapter.connect();
      const foreign = openForeignConnection(dbPath);
      try {
        foreign.exec('BEGIN EXCLUSIVE');
        setTimeout(() => foreign.exec('COMMIT'), 100);
        const startedAt = Date.now();

        expect(await adapter.ping()).toBe(true);

        expect(Date.now() - startedAt).toBeLessThan(1000);
      } finally {
        foreign.close();
        await adapter.disconnect();
      }
    });
  });
});
