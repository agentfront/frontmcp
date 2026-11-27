import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import { openNodeSqlite } from '../node-sqlite';
import type { SqliteDatabase } from '../sqlite-driver';

/** Whether the stores open their files with node:sqlite in this run (see `use-node-sqlite.ts`). */
export const onNodeSqlite = process.env['FRONTMCP_SQLITE_DRIVER'] === 'node:sqlite';

/** A connection outside the stores, with their library: two SQLite libraries in one process miss each other's locks. */
export function openRawDatabase(path: string): SqliteDatabase {
  return onNodeSqlite ? openNodeSqlite(path) : new (loadBetterSqlite3())(path);
}

/** A SQLite error as the stores' library reports it: better-sqlite3's `code`, or node:sqlite's `errcode`. */
export function sqliteError(code: string, errcode: number): ReturnType<typeof expect.objectContaining> {
  return expect.objectContaining(onNodeSqlite ? { code: 'ERR_SQLITE_ERROR', errcode } : { code });
}
