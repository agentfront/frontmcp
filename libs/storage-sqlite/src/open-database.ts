/**
 * openDatabase
 *
 * Shared helper to open a better-sqlite3 database file. Centralizes two
 * concerns that every file-backed SQLite store needs:
 *
 * 1. **Parent-directory creation.** better-sqlite3 will NOT create missing
 *    parent directories — opening `~/.frontmcp/data/auth.sqlite` when
 *    `~/.frontmcp/data` does not exist throws `SQLITE_CANTOPEN`. We create the
 *    parent dir synchronously first (skipping the special `:memory:` path).
 *
 * 2. **ESM-safe native module load.** See {@link loadBetterSqlite3}.
 */

import type Database from 'better-sqlite3';

import { dirname, ensureDirSync } from '@frontmcp/utils';

import { loadBetterSqlite3 } from './better-sqlite3-loader';

/** Special better-sqlite3 path that opens a transient in-memory database. */
const MEMORY_PATH = ':memory:';

/**
 * Open (or create) a better-sqlite3 database at `path`, creating the parent
 * directory if necessary.
 *
 * @param path - Filesystem path to the `.sqlite` file, or `:memory:`.
 * @param storeName - Name used in error messages (e.g. `'SqliteKvStore'`).
 * @returns An open better-sqlite3 `Database` instance.
 * @throws Error wrapping the underlying failure with the store name and path.
 */
export function openDatabase(path: string, storeName: string): Database.Database {
  const BetterSqlite3 = loadBetterSqlite3();

  // better-sqlite3 does not create parent dirs. Skip for in-memory and for
  // anonymous temp/disk databases (the empty-string path).
  if (path !== MEMORY_PATH && path !== '') {
    const dir = dirname(path);
    // dirname('foo.sqlite') === '.'; nothing to create in that case.
    if (dir && dir !== '.') {
      try {
        ensureDirSync(dir);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${storeName}: failed to create directory "${dir}" for database "${path}": ${message}`);
      }
    }
  }

  try {
    return new BetterSqlite3(path);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${storeName}: failed to open database at "${path}": ${message}`);
  }
}
