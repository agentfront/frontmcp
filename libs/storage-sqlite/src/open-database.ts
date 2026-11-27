/**
 * openDatabase
 *
 * Shared helper to open a SQLite database: with the driver set by `useSqliteDriver()`, or else with
 * better-sqlite3 (node:sqlite when it is not installed, or with `FRONTMCP_SQLITE_DRIVER=node:sqlite`),
 * which needs two things done for every file-backed store:
 *
 * 1. **Parent-directory creation.** better-sqlite3 will NOT create missing
 *    parent directories — opening `~/.frontmcp/data/auth.sqlite` when
 *    `~/.frontmcp/data` does not exist throws `SQLITE_CANTOPEN`. We create the
 *    parent dir synchronously first (skipping the special `:memory:` path).
 *
 * 2. **ESM-safe native module load.** See {@link loadBetterSqlite3}.
 */

import type Database from 'better-sqlite3';

import { dirname, ensureDirSync, getEnv } from '@frontmcp/utils';

import { loadBetterSqlite3 } from './better-sqlite3-loader';
import { hasNodeSqlite, isBuiltInNodeSqlite, openNodeSqlite } from './node-sqlite';
import { currentSqliteDriver, type SqliteDatabase, type SqliteDriver } from './sqlite-driver';

/** Picks the SQLite library when no driver is set: `better-sqlite3` or `node:sqlite`. */
const SQLITE_DRIVER_ENV = 'FRONTMCP_SQLITE_DRIVER';

/** node:sqlite's `errcode` for SQLITE_BUSY, in the low byte of its extended codes. */
const SQLITE_BUSY_CODE = 5;

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
  const { code, errcode } = (err ?? {}) as { code?: unknown; errcode?: unknown };
  if (code === 'ERR_SQLITE_ERROR') return typeof errcode === 'number' && (errcode & 0xff) === SQLITE_BUSY_CODE;
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

/** Whether `error` is better-sqlite3 itself missing, not a broken install of it. */
function isBetterSqlite3Missing(error: unknown): boolean {
  return (
    (error as { code?: unknown } | null)?.code === 'MODULE_NOT_FOUND' &&
    String((error as Error).message).includes("'better-sqlite3'")
  );
}

/** better-sqlite3, or node:sqlite when `FRONTMCP_SQLITE_DRIVER` asks for it or better-sqlite3 is not installed. */
function defaultDriver(storeName: string): SqliteDriver {
  const choice = getEnv(SQLITE_DRIVER_ENV);
  if (choice === 'node:sqlite') return openNodeSqlite;
  if (choice && choice !== 'better-sqlite3') {
    throw new Error(`${storeName}: ${SQLITE_DRIVER_ENV} must be "better-sqlite3" or "node:sqlite", not "${choice}"`);
  }
  try {
    const BetterSqlite3 = loadBetterSqlite3();
    return (databasePath) => new BetterSqlite3(databasePath);
  } catch (error: unknown) {
    if (choice || !isBetterSqlite3Missing(error) || !hasNodeSqlite()) throw error;
    return openNodeSqlite;
  }
}

/** Creates the parent directory of `path`: neither better-sqlite3 nor node:sqlite does. */
function ensureDatabaseDirectory(path: string, storeName: string): void {
  // Skip for in-memory and for anonymous temp/disk databases (the empty-string path).
  if (path === MEMORY_PATH || path === '') return;
  const dir = dirname(path);
  // dirname('foo.sqlite') === '.'; nothing to create in that case.
  if (!dir || dir === '.') return;
  try {
    ensureDirSync(dir);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${storeName}: failed to create directory "${dir}" for database "${path}": ${message}`, {
      cause: err,
    });
  }
}

/**
 * Open (or create) the database at `path`: with the driver set by `useSqliteDriver()`, or else with
 * better-sqlite3 (node:sqlite when it is not installed, or with `FRONTMCP_SQLITE_DRIVER=node:sqlite`),
 * creating the parent directory if necessary; `nodeSqlite()` creates it too.
 *
 * @param path - Filesystem path to the `.sqlite` file, or `:memory:`.
 * @param storeName - Name used in error messages (e.g. `'SqliteKvStore'`).
 * @param options - `busyTimeoutMs` (set before anything else touches the file) and `walMode`.
 * @returns An open better-sqlite3 `Database` instance. Opened by another driver (node:sqlite, or one set by
 *   `useSqliteDriver()`), it is that driver's database, which has the members of `SqliteDatabase` only.
 * @throws Error wrapping the underlying failure with the store name and path.
 */
export function openDatabase(path: string, storeName: string, options: OpenDatabaseOptions = {}): Database.Database {
  const driver = currentSqliteDriver();
  const open = driver ?? defaultDriver(storeName);
  if (!driver || isBuiltInNodeSqlite(driver)) ensureDatabaseDirectory(path, storeName);

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
  return db as Database.Database;
}
