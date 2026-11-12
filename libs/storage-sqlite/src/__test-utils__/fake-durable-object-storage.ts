import { loadBetterSqlite3 } from '../better-sqlite3-loader';
import type { DurableObjectStorageLike } from '../durable-object-sqlite';

type Row = Record<string, unknown>;

const TRANSACTION_STATEMENT = /^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const REFUSED_PRAGMA = /^PRAGMA\s+(busy_timeout|journal_mode)\b/i;
const PATTERN_MATCH = /\b(LIKE|GLOB)\b/i;
const MAX_PATTERN_BYTES = 50;

export const TRANSACTION_REFUSED =
  'To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs ' +
  'instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements.';
export const PRAGMA_REFUSED = 'not authorized: SQLITE_AUTH';
export const PATTERN_REFUSED = 'LIKE or GLOB pattern too complex: SQLITE_ERROR';
export const INSTANCE_ENDED = 'Cannot perform I/O on behalf of a different Durable Object.';

export interface FakeDurableObjectStorage extends DurableObjectStorageLike {
  /** Every query passed to `sql.exec()`, in order. */
  readonly queries: string[];
  /** Ends this instance, whose storage refuses every later call, and returns the storage of the next one. */
  nextInstance(): FakeDurableObjectStorage;
}

/** Throws what a Durable Object's SQLite throws for a statement it refuses. */
function refuse(statement: string, bindings: unknown[]): void {
  if (TRANSACTION_STATEMENT.test(statement)) throw new Error(TRANSACTION_REFUSED);
  if (REFUSED_PRAGMA.test(statement)) throw new Error(PRAGMA_REFUSED);
  const isLong = (binding: unknown) => typeof binding === 'string' && Buffer.byteLength(binding) > MAX_PATTERN_BYTES;
  if (PATTERN_MATCH.test(statement) && bindings.some(isLong)) throw new Error(PATTERN_REFUSED);
}

/** The storage of one instance of a Durable Object whose SQLite database is `database`. */
function storageOf(database: ReturnType<typeof openInMemory>): FakeDurableObjectStorage {
  const queries: string[] = [];
  let ended = false;

  /** A Durable Object refuses the calls made through an earlier instance's storage. */
  function assertCurrent(): void {
    if (ended) throw new Error(INSTANCE_ENDED);
  }

  /** As `SqlStorage.exec()`: the bindings and the cursor are those of the last statement. */
  function exec(query: string, ...bindings: unknown[]) {
    assertCurrent();
    queries.push(query);
    const statements = query
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) refuse(statement, bindings);
    const last = statements.pop() ?? '';
    for (const statement of statements) database.exec(statement);
    const prepared = database.prepare(last);
    const rows = prepared.reader ? (prepared.all(...bindings) as Row[]) : [];
    if (!prepared.reader) prepared.run(...bindings);
    return {
      toArray: () => rows,
      one: () => {
        if (rows.length !== 1) throw new Error(`Expected exactly one result from SQL query, but got ${rows.length}.`);
        return rows[0];
      },
    };
  }

  return {
    queries,
    sql: { exec },
    transactionSync: (operation) => {
      assertCurrent();
      return database.transaction(operation)();
    },
    nextInstance: () => {
      ended = true;
      return storageOf(database);
    },
  };
}

function openInMemory() {
  const BetterSqlite3 = loadBetterSqlite3();
  return new BetterSqlite3(':memory:');
}

/**
 * A Durable Object's storage on an in-memory better-sqlite3 database. It refuses what a Durable Object's
 * SQLite refuses: `BEGIN` and the other transaction statements, `PRAGMA busy_timeout` and `journal_mode`,
 * a LIKE or GLOB pattern over 50 bytes, and any call once the next instance has started.
 */
export function fakeDurableObjectStorage(): FakeDurableObjectStorage {
  return storageOf(openInMemory());
}
