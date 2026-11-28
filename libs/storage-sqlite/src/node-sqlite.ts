import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import type { SqliteDatabase, SqliteDriver, SqliteStatement } from './sqlite-driver';

/** better-sqlite3 binds `undefined` as NULL, node:sqlite refuses it. */
function bindable(params: unknown[]): SQLInputValue[] {
  return params.map((param) => (param === undefined ? null : param)) as SQLInputValue[];
}

/** A node:sqlite `DatabaseSync`, as the part of better-sqlite3's `Database` that the stores call. */
class NodeSqliteDatabase implements SqliteDatabase {
  constructor(private readonly db: DatabaseSync) {}

  get open(): boolean {
    return this.db.isOpen;
  }

  exec(source: string): void {
    this.db.exec(source);
  }

  prepare(source: string): SqliteStatement {
    const statement = this.db.prepare(source);
    return {
      get: (...params) => statement.get(...bindable(params)),
      all: (...params) => statement.all(...bindable(params)),
      run: (...params) => {
        const { changes, lastInsertRowid } = statement.run(...bindable(params));
        return { changes: Number(changes), lastInsertRowid };
      },
    };
  }

  pragma(source: string, options?: { simple?: boolean }): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all();
    return options?.simple ? Object.values(rows[0] ?? {})[0] : rows;
  }

  transaction<Result>(operation: () => Result): { immediate(): Result } {
    return {
      immediate: () => {
        this.db.exec('BEGIN IMMEDIATE');
        try {
          const result = operation();
          this.db.exec('COMMIT');
          return result;
        } catch (error: unknown) {
          if (this.db.isTransaction) this.db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

/** Node's built-in `node:sqlite`, or `undefined` on a runtime without it. */
function loadNodeSqlite(): typeof import('node:sqlite') | undefined {
  return globalThis.process?.getBuiltinModule?.('node:sqlite');
}

/** Whether this runtime has Node's built-in `node:sqlite`. */
export function hasNodeSqlite(): boolean {
  return loadNodeSqlite() !== undefined;
}

/** Opens `path` with node:sqlite; the folder must exist. */
export function openNodeSqlite(path: string): SqliteDatabase {
  const sqlite = loadNodeSqlite();
  if (!sqlite) throw new Error(`this runtime has no node:sqlite (Node ${globalThis.process?.version ?? 'unknown'})`);
  return new NodeSqliteDatabase(new sqlite.DatabaseSync(path));
}

/**
 * Marks the built-in node:sqlite driver, which `openDatabase` creates the folder for. A symbol from the global
 * registry, so a driver that the package's CommonJS copy set is known to its ESM copy too.
 */
const BUILT_IN_NODE_SQLITE = Symbol.for('frontmcp.sqliteDriver.builtInNodeSqlite');
Object.defineProperty(openNodeSqlite, BUILT_IN_NODE_SQLITE, { value: true });

/** Whether `driver` is the built-in node:sqlite driver of any copy of this package; a custom driver is not. */
export function isBuiltInNodeSqlite(driver: SqliteDriver): boolean {
  return (driver as SqliteDriver & { [BUILT_IN_NODE_SQLITE]?: unknown })[BUILT_IN_NODE_SQLITE] === true;
}

/**
 * A driver that opens every database with Node's built-in `node:sqlite` instead of better-sqlite3, creating the
 * folder as better-sqlite3's does: `useSqliteDriver(nodeSqlite())`. Without better-sqlite3 installed (an optional
 * peer dependency since 1.14), or with `FRONTMCP_SQLITE_DRIVER=node:sqlite`, the stores use it without one being set.
 */
export function nodeSqlite(): SqliteDriver {
  return openNodeSqlite;
}
