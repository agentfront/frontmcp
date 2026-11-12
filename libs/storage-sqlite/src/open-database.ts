/**
 * openDatabase
 *
 * Shared helper to open a SQLite database: with the driver set by `useSqliteDriver()`,
 * or else with better-sqlite3, which needs two things done for every file-backed store:
 *
 * 1. **Parent-directory creation.** better-sqlite3 will NOT create missing
 *    parent directories — opening `~/.frontmcp/data/auth.sqlite` when
 *    `~/.frontmcp/data` does not exist throws `SQLITE_CANTOPEN`. We create the
 *    parent dir synchronously first (skipping the special `:memory:` path).
 *
 * 2. **ESM-safe native module load.** See {@link loadBetterSqlite3}.
 */

import { dirname, ensureDirSync } from '@frontmcp/utils';

import { loadBetterSqlite3 } from './better-sqlite3-loader';
import { currentSqliteDriver, type SqliteDatabase, type SqliteDriver } from './sqlite-driver';

/** Special better-sqlite3 path that opens a transient in-memory database. */
const MEMORY_PATH = ':memory:';

/** How long a connection waits on another process's lock before SQLITE_BUSY. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenDatabaseOptions {
  /** Milliseconds to wait for a lock held by another connection or process. @default 5000 */
  busyTimeoutMs?: number;
  /** Switch the database to WAL journaling. @default false */
  walMode?: boolean;
}

export interface BusyRetryOptions {
  attempts?: number;
  delayMs?: number;
}

export function isBusyError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_BUSY_RECOVERY' || code === 'SQLITE_BUSY_SNAPSHOT';
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run a synchronous SQLite operation, retrying while it reports `SQLITE_BUSY`.
 * `busy_timeout` covers ordinary lock waits; a few statements (the WAL switch,
 * schema changes racing another process's first open) can still fail fast.
 * Blocks the event loop between attempts (750 ms at most by default): only for opening a store.
 */
export function withBusyRetry<T>(operation: () => T, options: BusyRetryOptions = {}): T {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 50;
  for (let attempt = 1; ; attempt++) {
    try {
      return operation();
    } catch (err: unknown) {
      if (!isBusyError(err) || attempt >= attempts) throw err;
      sleepSync(delayMs * attempt);
    }
  }
}

/** better-sqlite3 as a driver, once the parent directory of `path` exists: better-sqlite3 does not create it. */
function builtInDriver(path: string, storeName: string): SqliteDriver {
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
        throw new Error(`${storeName}: failed to create directory "${dir}" for database "${path}": ${message}`, {
          cause: err,
        });
      }
    }
  }

  return (databasePath) => new BetterSqlite3(databasePath);
}

/**
 * Open (or create) the database at `path`: with the driver set by `useSqliteDriver()`, or else with
 * better-sqlite3, creating the parent directory if necessary.
 *
 * @param path - Filesystem path to the `.sqlite` file, or `:memory:`.
 * @param storeName - Name used in error messages (e.g. `'SqliteKvStore'`).
 * @param options - `busyTimeoutMs` (set before anything else touches the file) and `walMode`.
 * @returns An open database: a better-sqlite3 `Database`, or the one the driver opened.
 * @throws Error wrapping the underlying failure with the store name and path.
 */
export function openDatabase(path: string, storeName: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const open = currentSqliteDriver() ?? builtInDriver(path, storeName);

  let db: SqliteDatabase;
  try {
    db = open(path);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${storeName}: failed to open database at "${path}": ${message}`, { cause: err });
  }

  try {
    // First, before WAL or any DDL: two processes opening the same file would
    // otherwise fail with SQLITE_BUSY instead of waiting for each other.
    db.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}`);
    if (options.walMode) withBusyRetry(() => db.pragma('journal_mode = WAL'));
  } catch (err: unknown) {
    db.close();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${storeName}: failed to configure database at "${path}": ${message}`, { cause: err });
  }
  return db;
}
