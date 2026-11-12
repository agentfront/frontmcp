import * as os from 'os';
import * as path from 'path';

import { fileExistsSync, mkdtemp, rm } from '@frontmcp/utils';

import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { openDatabase } from '../open-database';
import { currentSqliteDriver, useSqliteDriver, type SqliteDatabase } from '../sqlite-driver';
import { SqliteKvStore } from '../sqlite-kv.store';

jest.mock('../better-sqlite3-loader', () => {
  const actual = jest.requireActual<typeof import('../better-sqlite3-loader')>('../better-sqlite3-loader');
  return { loadBetterSqlite3: jest.fn(actual.loadBetterSqlite3) };
});

/** A database the driver under test hands out: in memory, whatever the path. */
function openInMemory(): SqliteDatabase {
  const BetterSqlite3 = jest.requireActual<typeof import('better-sqlite3')>('better-sqlite3');
  return new BetterSqlite3(':memory:');
}

describe('useSqliteDriver', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'sqlite-driver-'));
    dbPath = path.join(dir, 'missing', 'folder', 'db.sqlite');
    jest.mocked(loadBetterSqlite3).mockClear();
  });

  afterEach(async () => {
    useSqliteDriver(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('opens the database with the driver, without better-sqlite3 and without creating a folder', () => {
    const database = openInMemory();
    const driver = jest.fn(() => database);
    useSqliteDriver(driver);

    const opened = openDatabase(dbPath, 'TestStore');

    expect(opened).toBe(database);
    expect(driver).toHaveBeenCalledWith(dbPath);
    expect(loadBetterSqlite3).not.toHaveBeenCalled();
    expect(fileExistsSync(path.dirname(dbPath))).toBe(false);
    opened.close();
  });

  it('runs a store on the database the driver opened', () => {
    useSqliteDriver(openInMemory);

    const store = new SqliteKvStore({ path: dbPath, ttlCleanupIntervalMs: 0 });
    store.set('k', 'v');

    expect(store.get('k')).toBe('v');
    expect(loadBetterSqlite3).not.toHaveBeenCalled();
    expect(fileExistsSync(path.dirname(dbPath))).toBe(false);
    store.close();
  });

  it('names the store and the path when the driver fails', () => {
    useSqliteDriver(() => {
      throw new Error('no storage');
    });

    expect(() => openDatabase(dbPath, 'TestStore')).toThrow(
      `TestStore: failed to open database at "${dbPath}": no storage`,
    );
  });

  it('opens with better-sqlite3 again once the driver is unset', () => {
    useSqliteDriver(openInMemory);
    useSqliteDriver(undefined);

    const opened = openDatabase(dbPath, 'TestStore');

    expect(loadBetterSqlite3).toHaveBeenCalled();
    expect(fileExistsSync(dbPath)).toBe(true);
    opened.close();
  });

  it('shares the driver with another copy of the package in the same process', () => {
    useSqliteDriver(openInMemory);

    jest.isolateModules(() => {
      const otherCopy = require('../sqlite-driver') as typeof import('../sqlite-driver');
      expect(otherCopy.currentSqliteDriver).not.toBe(currentSqliteDriver);
      expect(otherCopy.currentSqliteDriver()).toBe(openInMemory);
    });
  });
});
