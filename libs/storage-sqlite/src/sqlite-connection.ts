import type Database from 'better-sqlite3';

import { pathResolve } from '@frontmcp/utils';

import {
  DEFAULT_BUSY_TIMEOUT_MS,
  isBusyError,
  openDatabase,
  withBusyRetry,
  type OpenDatabaseOptions,
} from './open-database';

const MIN_BACKOFF_MS = 2;
const MAX_BACKOFF_MS = 50;

/** Paths that open a new, private database each time, so they are never shared. */
const PRIVATE_PATHS = new Set([':memory:', '']);

const sharedByPath = new Map<string, SharedDatabase>();

class SharedDatabase {
  private references = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastProgressAt = 0;

  constructor(
    readonly db: Database.Database,
    private busyTimeoutMs: number,
    private readonly cacheKey?: string,
  ) {}

  retain(options: OpenDatabaseOptions): void {
    if (options.walMode && this.db.pragma('journal_mode', { simple: true }) !== 'wal') {
      withBusyRetry(() => this.db.pragma('journal_mode = WAL'));
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (busyTimeoutMs > this.busyTimeoutMs) {
      this.busyTimeoutMs = busyTimeoutMs;
      this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    }
    this.references++;
  }

  release(): void {
    if (--this.references > 0) return;
    if (this.cacheKey && sharedByPath.get(this.cacheKey) === this) sharedByPath.delete(this.cacheKey);
    this.db.close();
  }

  enqueue<T>(operation: () => T): Promise<T> {
    const calledAt = Date.now();
    const run = this.queue.then(() => this.retryWhileBusy(operation, calledAt));
    this.queue = run.catch(() => undefined);
    return run;
  }

  idle(): Promise<void> {
    return this.queue.then(() => undefined);
  }

  /** Waits for another process's lock with timers, not inside SQLite, so the event loop keeps running. */
  private async retryWhileBusy<T>(operation: () => T, calledAt: number): Promise<T> {
    for (let backoffMs = MIN_BACKOFF_MS; ; backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)) {
      try {
        const result = this.withoutBusyWait(operation);
        this.lastProgressAt = Date.now();
        return result;
      } catch (error: unknown) {
        // The busy timeout runs from the call, or from the last queued operation that got the lock if later.
        const remainingMs = Math.max(calledAt, this.lastProgressAt) + this.busyTimeoutMs - Date.now();
        if (!isBusyError(error) || remainingMs <= 0) throw error;
        const jitteredMs = backoffMs / 2 + Math.random() * (backoffMs / 2);
        await new Promise((wake) => setTimeout(wake, Math.min(jitteredMs, remainingMs)));
      }
    }
  }

  private withoutBusyWait<T>(operation: () => T): T {
    this.db.pragma('busy_timeout = 0');
    try {
      return operation();
    } finally {
      this.db.pragma(`busy_timeout = ${this.busyTimeoutMs}`);
    }
  }
}

/** A store's handle on the connection it shares with every store on the same file in this process. */
export class SqliteConnection {
  private released = false;

  constructor(private readonly shared: SharedDatabase) {}

  get db(): Database.Database {
    return this.shared.db;
  }

  /** Run `operation` in a `BEGIN IMMEDIATE` transaction, after this process's earlier queued operations. */
  write<T>(operation: () => T): Promise<T> {
    const transaction = this.shared.db.transaction(operation);
    return this.shared.enqueue(() => transaction.immediate());
  }

  /** Run `operation` outside a transaction, after this process's earlier queued operations. */
  read<T>(operation: () => T): Promise<T> {
    return this.shared.enqueue(operation);
  }

  /** Resolves once the operations queued so far have finished. */
  idle(): Promise<void> {
    return this.shared.idle();
  }

  /** The connection closes once every store that acquired it has released it; a second call does nothing. */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.shared.release();
  }
}

/** The connection to `path`, shared by resolved path; a later store can switch it to WAL or lengthen its busy timeout. */
export function acquireConnection(
  path: string,
  storeName: string,
  options: OpenDatabaseOptions = {},
): SqliteConnection {
  const cacheKey = PRIVATE_PATHS.has(path) ? undefined : pathResolve(path);
  let shared = cacheKey ? sharedByPath.get(cacheKey) : undefined;
  if (!shared?.db.open) {
    const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    shared = new SharedDatabase(openDatabase(path, storeName, options), busyTimeoutMs, cacheKey);
    if (cacheKey) sharedByPath.set(cacheKey, shared);
  }
  shared.retain(options);
  return new SqliteConnection(shared);
}
