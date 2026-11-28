import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { nodeSqlite, openNodeSqlite } from '../node-sqlite';
import { isBusyError, openDatabase } from '../open-database';
import { useSqliteDriver } from '../sqlite-driver';
import { SqliteKvStore } from '../sqlite-kv.store';
import { SqliteStorageAdapter } from '../sqlite-storage.adapter';

jest.mock('../better-sqlite3-loader', () => {
  const actual = jest.requireActual<typeof import('../better-sqlite3-loader')>('../better-sqlite3-loader');
  return { loadBetterSqlite3: jest.fn(actual.loadBetterSqlite3) };
});

const { loadBetterSqlite3: realLoad } =
  jest.requireActual<typeof import('../better-sqlite3-loader')>('../better-sqlite3-loader');
const BetterSqlite3 = realLoad();

function missing(module: string): Error {
  return Object.assign(new Error(`Cannot find module '${module}'\nRequire stack:\n- /app/server.js`), {
    code: 'MODULE_NOT_FOUND',
  });
}

function withoutBetterSqlite3(): void {
  jest.mocked(loadBetterSqlite3).mockImplementation(() => {
    throw missing('better-sqlite3');
  });
}

describe('the default SQLite driver', () => {
  let dir: string;
  let dbPath: string;
  const chosen = process.env['FRONTMCP_SQLITE_DRIVER'];

  beforeEach(() => {
    delete process.env['FRONTMCP_SQLITE_DRIVER'];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sqlite-'));
    dbPath = path.join(dir, 'missing', 'folder', 'db.sqlite');
    jest.mocked(loadBetterSqlite3).mockImplementation(realLoad).mockClear();
  });

  afterEach(() => {
    if (chosen === undefined) delete process.env['FRONTMCP_SQLITE_DRIVER'];
    else process.env['FRONTMCP_SQLITE_DRIVER'] = chosen;
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is better-sqlite3 when it is installed', () => {
    const db = openDatabase(dbPath, 'TestStore');

    expect(db).toBeInstanceOf(BetterSqlite3);
    db.close();
  });

  it('is node:sqlite when better-sqlite3 is not installed, and the folder is created', async () => {
    withoutBetterSqlite3();
    const builtIn = jest.spyOn(process, 'getBuiltinModule');

    const adapter = new SqliteStorageAdapter({ path: dbPath, ttlCleanupIntervalMs: 0 });
    await adapter.connect();
    await adapter.set('lock', 'a', { ifNotExists: true });
    await adapter.set('lock', 'b', { ifNotExists: true });

    expect(await adapter.get('lock')).toBe('a');
    expect(await adapter.incr('count')).toBe(1);
    expect(adapter.getKvStore().getDatabase()).not.toBeInstanceOf(BetterSqlite3);
    expect(builtIn).toHaveBeenCalledWith('node:sqlite');
    await adapter.disconnect();
    expect(fs.readFileSync(dbPath).subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('reports a broken better-sqlite3 install instead of switching to node:sqlite', () => {
    jest.mocked(loadBetterSqlite3).mockImplementation(() => {
      throw missing('bindings');
    });

    expect(() => openDatabase(dbPath, 'TestStore')).toThrow("Cannot find module 'bindings'");
  });

  it('reports the missing better-sqlite3 on a runtime without node:sqlite, and how to install it', () => {
    withoutBetterSqlite3();
    jest.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as never);

    expect(() => openDatabase(dbPath, 'TestStore')).toThrow(
      'TestStore: this runtime has no node:sqlite, but better-sqlite3 is not installed. It is an optional peer ' +
        'dependency of @frontmcp/storage-sqlite: install it next to the package (npm install better-sqlite3). ' +
        "Cannot find module 'better-sqlite3'",
    );
  });

  it('is node:sqlite with FRONTMCP_SQLITE_DRIVER=node:sqlite, without loading better-sqlite3', () => {
    process.env['FRONTMCP_SQLITE_DRIVER'] = 'node:sqlite';

    const store = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    store.set('k', 'v');

    expect(store.get('k')).toBe('v');
    expect(store.getDatabase()).not.toBeInstanceOf(BetterSqlite3);
    expect(loadBetterSqlite3).not.toHaveBeenCalled();
    store.close();
  });

  it('does not fall back with FRONTMCP_SQLITE_DRIVER=better-sqlite3, and says how to install it (#1512)', () => {
    process.env['FRONTMCP_SQLITE_DRIVER'] = 'better-sqlite3';
    withoutBetterSqlite3();

    let thrown: unknown;
    try {
      openDatabase(dbPath, 'TestStore');
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'TestStore: FRONTMCP_SQLITE_DRIVER=better-sqlite3 asks for it, but better-sqlite3 is not installed. It is an ' +
        'optional peer dependency of @frontmcp/storage-sqlite: install it next to the package ' +
        "(npm install better-sqlite3). Cannot find module 'better-sqlite3'\nRequire stack:\n- /app/server.js",
    );
    expect((thrown as Error).cause).toMatchObject({ code: 'MODULE_NOT_FOUND' });
  });

  it('is better-sqlite3 with FRONTMCP_SQLITE_DRIVER=better-sqlite3 when it is installed', () => {
    process.env['FRONTMCP_SQLITE_DRIVER'] = 'better-sqlite3';

    const db = openDatabase(dbPath, 'TestStore');

    expect(db).toBeInstanceOf(BetterSqlite3);
    db.close();
  });

  it('refuses another FRONTMCP_SQLITE_DRIVER value, naming the ones it takes', () => {
    process.env['FRONTMCP_SQLITE_DRIVER'] = 'sqlite3';

    expect(() => openDatabase(dbPath, 'TestStore')).toThrow(
      'TestStore: FRONTMCP_SQLITE_DRIVER must be "better-sqlite3" or "node:sqlite", not "sqlite3"',
    );
  });
});

describe('nodeSqlite()', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sqlite-driver-'));
    jest.mocked(loadBetterSqlite3).mockClear();
  });

  afterEach(() => {
    useSqliteDriver(undefined);
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens every store with node:sqlite, creating the folder, without loading better-sqlite3', () => {
    useSqliteDriver(nodeSqlite());
    const dbPath = path.join(dir, 'nested', 'db.sqlite');

    const store = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    store.set('k', 'v', 60_000);

    expect(store.get('k')).toBe('v');
    expect(store.getDatabase()).not.toBeInstanceOf(BetterSqlite3);
    expect(loadBetterSqlite3).not.toHaveBeenCalled();
    store.close();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('creates the folder when another copy of the package set nodeSqlite(), as a CommonJS and an ESM copy do', () => {
    jest.isolateModules(() => {
      const otherCopy = require('../node-sqlite') as typeof import('../node-sqlite');
      expect(otherCopy.nodeSqlite()).not.toBe(nodeSqlite());
      useSqliteDriver(otherCopy.nodeSqlite());
    });
    const dbPath = path.join(dir, 'made', 'by', 'the-other-copy.sqlite');

    const db = openDatabase(dbPath, 'TestStore');
    db.close();

    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('names node:sqlite on a runtime without it', () => {
    jest.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as never);
    useSqliteDriver(nodeSqlite());

    expect(() => openDatabase(':memory:', 'TestStore')).toThrow(
      /TestStore: failed to open database at ":memory:": this runtime has no node:sqlite/,
    );
  });
});

describe('a node:sqlite database', () => {
  it('binds undefined as NULL, as better-sqlite3 does', () => {
    const db = openNodeSqlite(':memory:');
    db.exec('CREATE TABLE t (a, b)');

    expect(db.prepare('INSERT INTO t VALUES (?, ?)').run('x', undefined)).toEqual(
      expect.objectContaining({ changes: 1 }),
    );
    expect(db.prepare('SELECT a, b FROM t WHERE b IS ?').get(undefined)).toEqual({ a: 'x', b: null });
    expect(db.prepare('SELECT a FROM t').all()).toEqual([{ a: 'x' }]);
    db.close();
  });

  it('answers pragmas as better-sqlite3 does: rows, or the first value with simple', () => {
    const db = openNodeSqlite(':memory:');

    expect(db.pragma('busy_timeout = 250')).toEqual([{ timeout: 250 }]);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(250);
    db.close();
  });

  it('commits an immediate transaction, and rolls it back when the operation throws', () => {
    const db = openNodeSqlite(':memory:');
    db.exec('CREATE TABLE t (a)');
    const insert = db.prepare('INSERT INTO t VALUES (?)');

    expect(db.transaction(() => insert.run(1).changes).immediate()).toBe(1);
    expect(() =>
      db
        .transaction(() => {
          insert.run(2);
          throw new Error('abort');
        })
        .immediate(),
    ).toThrow('abort');

    expect(db.prepare('SELECT a FROM t').all()).toEqual([{ a: 1 }]);
    db.close();
  });

  it('is closed once, as a second close() does nothing', () => {
    const db = openNodeSqlite(':memory:');

    db.close();
    db.close();

    expect(db.open).toBe(false);
  });

  it('reports another connection holding the lock as a busy error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-sqlite-busy-'));
    const dbPath = path.join(dir, 'db.sqlite');
    const holder = openNodeSqlite(dbPath);
    const waiter = openNodeSqlite(dbPath);
    try {
      waiter.pragma('busy_timeout = 0');
      holder.exec('BEGIN IMMEDIATE');

      let error: unknown;
      try {
        waiter.transaction(() => undefined).immediate();
      } catch (thrown) {
        error = thrown;
      }

      expect(error).toEqual(expect.objectContaining({ code: 'ERR_SQLITE_ERROR', errcode: 5 }));
      expect(isBusyError(error)).toBe(true);
    } finally {
      holder.close();
      waiter.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isBusyError', () => {
  const nodeError = (errcode: number) => Object.assign(new Error('sqlite'), { code: 'ERR_SQLITE_ERROR', errcode });

  it("reads node:sqlite's extended codes for SQLITE_BUSY, SQLITE_BUSY_RECOVERY and SQLITE_BUSY_SNAPSHOT", () => {
    expect([5, 261, 517].map((errcode) => isBusyError(nodeError(errcode)))).toEqual([true, true, true]);
  });

  it('is false for the other node:sqlite errors', () => {
    expect([1, 6, 19, 26].map((errcode) => isBusyError(nodeError(errcode)))).toEqual([false, false, false, false]);
    expect(isBusyError({ code: 'ERR_SQLITE_ERROR' })).toBe(false);
  });

  it("still reads better-sqlite3's codes", () => {
    expect(isBusyError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isBusyError({ code: 'SQLITE_LOCKED' })).toBe(false);
    expect(isBusyError(null)).toBe(false);
  });
});
