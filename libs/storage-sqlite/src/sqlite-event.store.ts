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

/** Bundled prepared statements - all-or-nothing initialization. */
interface PreparedStatements {
  insert: Database.Statement;
  getAfter: Database.Statement;
  getStreamId: Database.Statement;
  count: Database.Statement;
  evictOldest: Database.Statement;
  evictExpired: Database.Statement;
  getLastId: Database.Statement;
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
  private stmts: PreparedStatements | null = null;

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
    this.stmts = {
      insert: this.db.prepare('INSERT INTO events (id, stream_id, message, created_at) VALUES (?, ?, ?, ?)'),
      getAfter: this.db.prepare(
        'SELECT id, message, created_at FROM events WHERE stream_id = ? AND rowid > (SELECT rowid FROM events WHERE id = ?) AND created_at > ? ORDER BY rowid ASC',
      ),
      getStreamId: this.db.prepare('SELECT stream_id FROM events WHERE id = ?'),
      count: this.db.prepare('SELECT COUNT(*) as count FROM events'),
      evictOldest: this.db.prepare(
        'DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at ASC LIMIT ?)',
      ),
      evictExpired: this.db.prepare('DELETE FROM events WHERE created_at <= ?'),
      getLastId: this.db.prepare('SELECT id FROM events WHERE stream_id = ? ORDER BY rowid DESC LIMIT 1'),
    };
  }

  /**
   * Return prepared statements, throwing if not yet initialized.
   */
  private prepared(): PreparedStatements {
    if (!this.stmts) {
      throw new Error('SqliteEventStore: prepared statements not initialized. Was prepareStatements() called?');
    }
    return this.stmts;
  }

  /**
   * Get the next counter value for a stream, rehydrating from SQLite on first use.
   */
  private getNextCounter(streamId: string): number {
    let counter = this.counters.get(streamId);
    if (counter === undefined) {
      // Rehydrate from SQLite: find the last event ID for this stream
      const stmts = this.prepared();
      const row = stmts.getLastId.get(streamId) as { id: string } | undefined;
      if (row) {
        const lastSegment = row.id.split(':').pop();
        counter = lastSegment ? parseInt(lastSegment, 10) : 0;
        if (isNaN(counter)) counter = 0;
      } else {
        counter = 0;
      }
    }
    counter += 1;
    this.counters.set(streamId, counter);
    return counter;
  }

  async storeEvent(streamId: string, message: unknown): Promise<string> {
    const stmts = this.prepared();
    this.evictExpired();

    const counter = this.getNextCounter(streamId);
    const id = `${streamId}:${counter}`;
    const now = Date.now();

    stmts.insert.run(id, streamId, JSON.stringify(message), now);

    // Evict oldest if over max
    const countRow = stmts.count.get() as { count: number };
    if (countRow.count > this.maxEvents) {
      const excess = countRow.count - this.maxEvents;
      stmts.evictOldest.run(excess);
    }

    return id;
  }

  async replayEventsAfter(
    lastEventId: string,
    { send }: { send: (eventId: string, message: unknown) => Promise<void> },
  ): Promise<string> {
    const stmts = this.prepared();
    // Find the stream for this event
    const streamRow = stmts.getStreamId.get(lastEventId) as { stream_id: string } | undefined;
    if (!streamRow) {
      // Unknown lastEventId: return a default stream
      return 'default-stream';
    }

    const streamId = streamRow.stream_id;
    const expiryCutoff = Date.now() - this.ttlMs;

    const rows = stmts.getAfter.all(streamId, lastEventId, expiryCutoff) as {
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
    const stmts = this.prepared();
    const cutoff = Date.now() - this.ttlMs;
    stmts.evictExpired.run(cutoff);
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
    const stmts = this.prepared();
    const row = stmts.count.get() as { count: number };
    return row.count;
  }
}
