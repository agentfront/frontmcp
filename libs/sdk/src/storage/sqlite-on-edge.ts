import { requireOptionalModule } from '../scope/optional-dependency.util';

/** What makes a SQLite store run on an edge runtime, for the errors that refuse it there. */
export const SQLITE_ON_EDGE_REMEDY =
  'In a Cloudflare Durable Object, register @frontmcp/storage-sqlite with registerOptionalModule() and call ' +
  'useSqliteDriver(durableObjectSqlite(ctx.storage)) in its constructor.';

/** Whether `@frontmcp/storage-sqlite` loads and has a driver set: the one way to open a database on an edge runtime. */
export function hasSqliteDriver(): boolean {
  try {
    const sqliteStorage = requireOptionalModule(
      '@frontmcp/storage-sqlite',
      () => require('@frontmcp/storage-sqlite') as typeof import('@frontmcp/storage-sqlite'),
    );
    return sqliteStorage.currentSqliteDriver() !== undefined;
  } catch {
    return false;
  }
}
