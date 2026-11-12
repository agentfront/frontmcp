import type { SqliteDatabase, SqliteDriver, SqliteStatement } from './sqlite-driver';

type Row = Record<string, unknown>;

/** Minimal structural view of a Durable Object's `state.storage`: the members `durableObjectSqlite()` uses. */
export interface DurableObjectStorageLike {
  sql: {
    exec(query: string, ...bindings: unknown[]): { toArray(): Row[]; one(): Row };
  };
  transactionSync<Result>(operation: () => Result): Result;
}

/** The pragmas the stores use that a Durable Object refuses (`SQLITE_AUTH`), answered as its one connection behaves. */
const REFUSED_PRAGMAS = new Map<string, unknown>([
  ['busy_timeout', 0],
  ['journal_mode', 'wal'],
]);

/** A Durable Object's SQLite database, as the part of better-sqlite3's `Database` that the stores call. */
class DurableObjectDatabase implements SqliteDatabase {
  open = true;

  constructor(private readonly storage: DurableObjectStorageLike) {}

  exec(source: string): void {
    this.storage.sql.exec(source).toArray();
  }

  prepare(source: string): SqliteStatement {
    const all = (...params: unknown[]): Row[] => this.storage.sql.exec(source, ...params).toArray();
    return {
      all,
      get: (...params) => all(...params)[0],
      run: (...params) => {
        all(...params);
        // The cursor's `rowsWritten` counts index rows too.
        return { changes: Number(this.storage.sql.exec('SELECT changes() AS changes').one()['changes']) };
      },
    };
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const name = source.split('=')[0].trim().toLowerCase();
    const rows = REFUSED_PRAGMAS.has(name)
      ? [{ [name]: REFUSED_PRAGMAS.get(name) }]
      : this.storage.sql.exec(`PRAGMA ${source}`).toArray();
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  /** A Durable Object refuses `BEGIN`; `transactionSync()` runs the operation in its transaction. */
  transaction<Result>(operation: () => Result): { immediate(): Result } {
    return { immediate: () => this.storage.transactionSync(operation) };
  }

  close(): void {
    this.open = false;
  }
}

/**
 * A driver that runs the stores on a Durable Object's own SQLite database. In the Durable Object's
 * constructor, before the server is created: `useSqliteDriver(durableObjectSqlite(ctx.storage))`.
 * Every path a store opens is that one database, so `sqlite.path` only names it. The driver is set for the whole
 * isolate, so use it in a class with one instance (one id, as `idFromName('main')`): instances with other ids can
 * share the isolate, where the storage set last opens every instance's stores and Cloudflare refuses the I/O
 * (`Cannot perform I/O on behalf of a different Durable Object`).
 */
export function durableObjectSqlite(storage: DurableObjectStorageLike): SqliteDriver {
  return () => new DurableObjectDatabase(storage);
}
