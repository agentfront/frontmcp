/**
 * SQLite Event Store
 *
 * Implements the EventStore interface from @modelcontextprotocol/sdk for SSE resumability.
 * Stores events in SQLite with TTL-based expiration and max event limits.
 */

import type Database from 'better-sqlite3';
import type { SqliteStorageOptions } from './sqlite.options';

/**
 * Event store interface matching @modelcontextprotocol/sdk EventStore.
 * Redeclared here to avoid hard dependency on @modelcontextprotocol/sdk.
 */
export interface EventStoreInterface {
  storeEvent(streamId: string, message: unknown): Promise<string>;
  replayEventsAfter(
    lastEventId: string,
    callbacks: { send: (eventId: string, message: unknown) => Promise<void> },
  ): Promise<string>;
}

export interface SqliteEventStoreOptions extends SqliteStorageOptions {
  /** Maximum number of events to store before eviction. @default 10000 */
  maxEvents?: number;
  /** TTL in milliseconds for stored events. @default 300000 (5 minutes) */
  ttlMs?: number;
}

/**
 * SQLite-backed event store for SSE resumability.
 *
 * Schema:
 * ```sql
 * CREATE TABLE IF NOT EXISTS events (
 *   id         TEXT PRIMARY KEY,
 *   stream_id  TEXT NOT NULL,
 *   message    TEXT NOT NULL,
 *   created_at INTEGER NOT NULL
 * );
 * ```
 */
export class SqliteEventStore implements EventStoreInterface {
  private db: Database.Database;
  private maxEvents: number;
  private ttlMs: number;
  private counters = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Prepared statements
  private stmtInsert!: Database.Statement;
  private stmtGetAfter!: Database.Statement;
  private stmtGetStreamId!: Database.Statement;
  private stmtCount!: Database.Statement;
  private stmtEvictOldest!: Database.Statement;
  private stmtEvictExpired!: Database.Statement;

  constructor(options: SqliteEventStoreOptions) {
    // Lazy require
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new BetterSqlite3(options.path);

    if (options.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    this.maxEvents = options.maxEvents ?? 10000;
    this.ttlMs = options.ttlMs ?? 300000;

    this.initSchema();
    this.prepareStatements();

    // Periodic cleanup of expired events
    const cleanupInterval = options.ttlCleanupIntervalMs ?? 60000;
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.evictExpired(), cleanupInterval);
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref();
      }
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         TEXT PRIMARY KEY,
        stream_id  TEXT NOT NULL,
        message    TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_stream ON events(stream_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    `);
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare('INSERT INTO events (id, stream_id, message, created_at) VALUES (?, ?, ?, ?)');
    this.stmtGetAfter = this.db.prepare(
      'SELECT id, message, created_at FROM events WHERE stream_id = ? AND rowid > (SELECT rowid FROM events WHERE id = ?) AND created_at > ? ORDER BY rowid ASC',
    );
    this.stmtGetStreamId = this.db.prepare('SELECT stream_id FROM events WHERE id = ?');
    this.stmtCount = this.db.prepare('SELECT COUNT(*) as count FROM events');
    this.stmtEvictOldest = this.db.prepare(
      'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at ASC LIMIT ?)',
    );
    this.stmtEvictExpired = this.db.prepare('DELETE FROM events WHERE created_at <= ?');
  }

  async storeEvent(streamId: string, message: unknown): Promise<string> {
    this.evictExpired();

    const counter = (this.counters.get(streamId) ?? 0) + 1;
    this.counters.set(streamId, counter);

    const id = `${streamId}:${counter}`;
    const now = Date.now();

    this.stmtInsert.run(id, streamId, JSON.stringify(message), now);

    // Evict oldest if over max
    const countRow = this.stmtCount.get() as { count: number };
    if (countRow.count > this.maxEvents) {
      const excess = countRow.count - this.maxEvents;
      this.stmtEvictOldest.run(excess);
    }

    return id;
  }

  async replayEventsAfter(
    lastEventId: string,
    { send }: { send: (eventId: string, message: unknown) => Promise<void> },
  ): Promise<string> {
    // Find the stream for this event
    const streamRow = this.stmtGetStreamId.get(lastEventId) as { stream_id: string } | undefined;
    if (!streamRow) {
      // Unknown lastEventId: return a default stream
      return 'default-stream';
    }

    const streamId = streamRow.stream_id;
    const expiryCutoff = Date.now() - this.ttlMs;

    const rows = this.stmtGetAfter.all(streamId, lastEventId, expiryCutoff) as {
      id: string;
      message: string;
      created_at: number;
    }[];

    for (const row of rows) {
      await send(row.id, JSON.parse(row.message));
    }

    return streamId;
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    this.stmtEvictExpired.run(cutoff);
  }

  /**
   * Close the database connection and stop cleanup timer.
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.db.close();
  }

  /**
   * Get the current number of stored events.
   */
  get size(): number {
    const row = this.stmtCount.get() as { count: number };
    return row.count;
  }
}
