/** The part of a better-sqlite3 statement that the stores call. */
export interface SqliteStatement {
  /** The first row, or `undefined` when there is none. */
  get(...params: unknown[]): unknown;
  /** Every row. */
  all(...params: unknown[]): unknown[];
  /** Runs the statement; `changes` is the number of rows it inserted, updated or deleted. */
  run(...params: unknown[]): { changes: number };
}

/** The part of better-sqlite3's `Database` that the stores call: what a driver's database has to provide. */
export interface SqliteDatabase {
  /** False once the database is closed; a closed connection is never reused. */
  readonly open: boolean;
  /** Runs one or more statements that take no parameters. */
  exec(source: string): unknown;
  prepare(source: string): SqliteStatement;
  /** The stores set `busy_timeout` and `journal_mode`, and read `journal_mode` and `data_version` with `simple`. */
  pragma(source: string, options?: { simple?: boolean }): unknown;
  /** Wraps `operation` in a transaction; the stores run it with `.immediate()` (`BEGIN IMMEDIATE`). */
  transaction<Result>(operation: () => Result): { immediate(): Result };
  close(): unknown;
}

/** Opens the database a store asks for by `path`: a file path, `:memory:` or an empty string. */
export type SqliteDriver = (path: string) => SqliteDatabase;

const SQLITE_DRIVER = Symbol.for('frontmcp.sqliteDriver');

type SqliteDriverHost = typeof globalThis & { [SQLITE_DRIVER]?: SqliteDriver };

/**
 * Sets the driver that opens every database from now on, in place of better-sqlite3; `undefined` restores it.
 * With a driver set, no folder is created and better-sqlite3 is not loaded. Kept on `globalThis`, so the
 * package's CommonJS and ESM copies share it. There is one driver for the whole process or isolate: every server
 * in it opens its stores with the driver set last, so set one only where a single database serves them all.
 */
export function useSqliteDriver(driver: SqliteDriver | undefined): void {
  (globalThis as SqliteDriverHost)[SQLITE_DRIVER] = driver;
}

/** The driver set with {@link useSqliteDriver}, or `undefined` when better-sqlite3 opens the databases. */
export function currentSqliteDriver(): SqliteDriver | undefined {
  return (globalThis as SqliteDriverHost)[SQLITE_DRIVER];
}
