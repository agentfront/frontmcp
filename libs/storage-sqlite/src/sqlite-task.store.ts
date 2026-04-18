/**
 * SQLite Task Store
 *
 * Implements the FrontMCP `TaskStore` interface on top of better-sqlite3.
 * Suitable for single-host deployments — including the CLI runner — where
 * tasks outlive a single HTTP or stdio session but don't need cross-node
 * pub/sub. Pub/sub is served by an in-process EventEmitter (same pattern as
 * SqliteElicitationStore).
 *
 * Schema:
 * ```sql
 * CREATE TABLE IF NOT EXISTS mcp_tasks (
 *   task_id       TEXT PRIMARY KEY,
 *   session_id    TEXT NOT NULL,
 *   status        TEXT NOT NULL,
 *   expires_at    INTEGER NOT NULL,
 *   created_at    INTEGER NOT NULL,
 *   updated_at    INTEGER NOT NULL,
 *   executor_pid  INTEGER,
 *   record_json   TEXT NOT NULL
 * );
 * ```
 *
 * @module storage-sqlite/sqlite-task.store
 */

import { EventEmitter } from 'node:events';

import type Database from 'better-sqlite3';

import { decryptValue, deriveEncryptionKey, encryptValue } from './encryption';
import type { SqliteStorageOptions } from './sqlite.options';

// ───────────────────────────────────────────────────────────────
// Interface (mirrored from @frontmcp/sdk to avoid a circular dep)
// ───────────────────────────────────────────────────────────────

export interface TaskJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type TaskOutcome = { kind: 'ok'; data: unknown } | { kind: 'error'; error: TaskJsonRpcError };

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export interface TaskRecord {
  taskId: string;
  sessionId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs?: number;
  expiresAt: number;
  request: { method: 'tools/call'; params: Record<string, unknown> };
  outcome?: TaskOutcome;
  progressToken?: string | number;
  executor?: {
    host: 'in-process' | 'cli';
    pid?: number;
    spawnedAt?: string;
  };
}

export type TaskTerminalCallback = (record: TaskRecord) => void;
export type TaskCancelCallback = () => void;
export type TaskUnsubscribe = () => Promise<void>;
export interface TaskListPage {
  tasks: TaskRecord[];
  nextCursor?: string;
}

export interface TaskStoreInterface {
  create(record: TaskRecord): Promise<void>;
  get(taskId: string, sessionId: string): Promise<TaskRecord | null>;
  update(taskId: string, sessionId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null>;
  delete(taskId: string, sessionId: string): Promise<void>;
  list(sessionId: string, opts?: { cursor?: string; pageSize?: number }): Promise<TaskListPage>;
  subscribeTerminal(taskId: string, sessionId: string, cb: TaskTerminalCallback): Promise<TaskUnsubscribe>;
  publishTerminal(record: TaskRecord): Promise<void>;
  subscribeCancel(taskId: string, sessionId: string, cb: TaskCancelCallback): Promise<TaskUnsubscribe>;
  publishCancel(taskId: string, sessionId: string): Promise<void>;
  destroy?(): Promise<void>;
}

// ───────────────────────────────────────────────────────────────
// Logger shim — avoids depending on @frontmcp/sdk from this package.
// ───────────────────────────────────────────────────────────────

export interface SqliteTaskLogger {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
}

// ───────────────────────────────────────────────────────────────
// Orphan-detection hook
// ───────────────────────────────────────────────────────────────

/** Returns `true` if the process with the given PID is alive. */
export type ProcessLivenessProbe = (pid: number) => boolean;

const defaultLivenessProbe: ProcessLivenessProbe = (pid) => {
  try {
    // Signal 0 sends nothing but throws ESRCH if the PID is dead.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ───────────────────────────────────────────────────────────────
// Store
// ───────────────────────────────────────────────────────────────

export interface SqliteTaskStoreOptions extends SqliteStorageOptions {
  logger?: SqliteTaskLogger;
  /**
   * Override the PID liveness check (primarily for tests).
   * Defaults to `process.kill(pid, 0)` semantics.
   */
  livenessProbe?: ProcessLivenessProbe;
}

const DEFAULT_PAGE_SIZE = 50;

interface TaskRow {
  task_id: string;
  session_id: string;
  status: TaskStatus;
  expires_at: number;
  created_at: number;
  updated_at: number;
  executor_pid: number | null;
  record_json: string;
}

interface Prepared {
  insert: Database.Statement;
  get: Database.Statement;
  update: Database.Statement;
  del: Database.Statement;
  listBySession: Database.Statement;
  countBySession: Database.Statement;
  cleanup: Database.Statement;
}

export class SqliteTaskStore implements TaskStoreInterface {
  private readonly db: Database.Database;
  private readonly emitter = new EventEmitter();
  private readonly logger?: SqliteTaskLogger;
  private readonly liveness: ProcessLivenessProbe;
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null;
  /**
   * AES-256-GCM key derived from `options.encryption.secret`, applied to the
   * `record_json` column on write and reversed on read. Other columns
   * (`task_id`, `session_id`, `status`, `expires_at`, `executor_pid`) are kept
   * in plaintext so the indexes remain usable.
   */
  private readonly encryptionKey: Uint8Array | null = null;
  private stmts: Prepared | null = null;

  constructor(options: SqliteTaskStoreOptions) {
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    try {
      this.db = new BetterSqlite3(options.path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`SqliteTaskStore: failed to open database at "${options.path}": ${message}`);
    }

    if (options.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    this.logger = options.logger;
    this.liveness = options.livenessProbe ?? defaultLivenessProbe;
    if (options.encryption?.secret) {
      this.encryptionKey = deriveEncryptionKey(options.encryption.secret);
    }
    this.emitter.setMaxListeners(200);

    this.initSchema();
    this.prepareStatements();

    const cleanupInterval = options.ttlCleanupIntervalMs ?? 60_000;
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.purgeExpired(), cleanupInterval);
      this.cleanupTimer.unref?.();
    } else {
      this.cleanupTimer = null;
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_tasks (
        task_id       TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        status        TEXT NOT NULL,
        expires_at    INTEGER NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        executor_pid  INTEGER,
        record_json   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_tasks_session  ON mcp_tasks (session_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_tasks_status   ON mcp_tasks (status);
      CREATE INDEX IF NOT EXISTS idx_mcp_tasks_expires  ON mcp_tasks (expires_at);
    `);
  }

  private prepareStatements(): void {
    this.stmts = {
      insert: this.db.prepare(
        'INSERT INTO mcp_tasks (task_id, session_id, status, expires_at, created_at, updated_at, executor_pid, record_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ),
      get: this.db.prepare('SELECT * FROM mcp_tasks WHERE task_id = ? AND session_id = ?'),
      update: this.db.prepare(
        'UPDATE mcp_tasks SET status = ?, expires_at = ?, updated_at = ?, executor_pid = ?, record_json = ? WHERE task_id = ? AND session_id = ?',
      ),
      del: this.db.prepare('DELETE FROM mcp_tasks WHERE task_id = ? AND session_id = ?'),
      listBySession: this.db.prepare(
        'SELECT * FROM mcp_tasks WHERE session_id = ? AND expires_at > ? ORDER BY created_at ASC, task_id ASC LIMIT ? OFFSET ?',
      ),
      countBySession: this.db.prepare('SELECT COUNT(*) as n FROM mcp_tasks WHERE session_id = ? AND expires_at > ?'),
      cleanup: this.db.prepare('DELETE FROM mcp_tasks WHERE expires_at <= ?'),
    };
  }

  private prepared(): Prepared {
    if (!this.stmts) throw new Error('SqliteTaskStore: prepared statements not initialized');
    return this.stmts;
  }

  // ───────────────────── CRUD ─────────────────────

  async create(record: TaskRecord): Promise<void> {
    if (record.expiresAt <= Date.now()) {
      this.logger?.warn?.('[SqliteTaskStore] create: record already expired', { taskId: record.taskId });
      return;
    }
    this.prepared().insert.run(
      record.taskId,
      record.sessionId,
      record.status,
      record.expiresAt,
      new Date(record.createdAt).getTime(),
      new Date(record.lastUpdatedAt).getTime(),
      record.executor?.pid ?? null,
      this.serializeRecord(record),
    );
  }

  async get(taskId: string, sessionId: string): Promise<TaskRecord | null> {
    const row = this.prepared().get.get(taskId, sessionId) as TaskRow | undefined;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.prepared().del.run(taskId, sessionId);
      return null;
    }
    const record = this.rowToRecord(row);
    // Orphan detection: if a CLI executor owns the task and its PID is dead,
    // auto-transition to failed. Spec §Task Lifecycle: only `working` and
    // `input_required` are non-terminal — don't touch anything else.
    if (
      (record.status === 'working' || record.status === 'input_required') &&
      record.executor?.host === 'cli' &&
      typeof record.executor.pid === 'number' &&
      !this.liveness(record.executor.pid)
    ) {
      const patched = await this.update(taskId, sessionId, {
        status: 'failed',
        statusMessage: 'Task runner exited before completing the task',
      });
      if (patched) {
        // Publish the synthetic terminal event so `tasks/result` waiters
        // already blocked on `subscribeTerminal` get unblocked immediately.
        await this.publishTerminal(patched);
        return patched;
      }
    }
    return record;
  }

  async update(taskId: string, sessionId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null> {
    // Direct raw read to skip orphan detection (we're about to write).
    const row = this.prepared().get.get(taskId, sessionId) as TaskRow | undefined;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.prepared().del.run(taskId, sessionId);
      return null;
    }
    const existing = this.rowToRecord(row);
    const merged: TaskRecord = {
      ...existing,
      ...patch,
      taskId: existing.taskId,
      sessionId: existing.sessionId,
      createdAt: existing.createdAt,
      lastUpdatedAt: new Date().toISOString(),
    };
    if (merged.expiresAt <= Date.now()) {
      this.prepared().del.run(taskId, sessionId);
      return null;
    }
    this.prepared().update.run(
      merged.status,
      merged.expiresAt,
      new Date(merged.lastUpdatedAt).getTime(),
      merged.executor?.pid ?? null,
      this.serializeRecord(merged),
      taskId,
      sessionId,
    );
    return merged;
  }

  async delete(taskId: string, sessionId: string): Promise<void> {
    this.prepared().del.run(taskId, sessionId);
  }

  async list(sessionId: string, opts: { cursor?: string; pageSize?: number } = {}): Promise<TaskListPage> {
    const pageSize = Math.max(1, Math.min(opts.pageSize ?? DEFAULT_PAGE_SIZE, 500));
    const offset = opts.cursor ? decodeCursor(opts.cursor) : 0;
    const rows = this.prepared().listBySession.all(sessionId, Date.now(), pageSize, offset) as TaskRow[];

    // Orphan-detect any non-terminal CLI-owned tasks whose worker PID has died
    // before handing the page back. Cheap: only probes the small subset that
    // plausibly needs it.
    const tasks: TaskRecord[] = [];
    for (const row of rows) {
      let record = this.rowToRecord(row);
      if (
        (record.status === 'working' || record.status === 'input_required') &&
        record.executor?.host === 'cli' &&
        typeof record.executor.pid === 'number' &&
        !this.liveness(record.executor.pid)
      ) {
        const patched = await this.update(record.taskId, sessionId, {
          status: 'failed',
          statusMessage: 'Task runner exited before completing the task',
        });
        if (patched) {
          // Publish so any blocked `tasks/result` subscriber wakes up now.
          await this.publishTerminal(patched);
          record = patched;
        }
      }
      tasks.push(record);
    }
    const total = (this.prepared().countBySession.get(sessionId, Date.now()) as { n: number }).n;
    const page: TaskListPage = { tasks };
    if (offset + rows.length < total) {
      page.nextCursor = encodeCursor(offset + rows.length);
    }
    return page;
  }

  // ───────────────────── Pub/Sub (in-process) ─────────────────────

  async subscribeTerminal(taskId: string, _sessionId: string, cb: TaskTerminalCallback): Promise<TaskUnsubscribe> {
    const channel = `terminal:${taskId}`;
    const handler = (record: TaskRecord) => cb(record);
    this.emitter.on(channel, handler);
    return async () => {
      this.emitter.removeListener(channel, handler);
    };
  }

  async publishTerminal(record: TaskRecord): Promise<void> {
    this.emitter.emit(`terminal:${record.taskId}`, record);
  }

  async subscribeCancel(taskId: string, _sessionId: string, cb: TaskCancelCallback): Promise<TaskUnsubscribe> {
    const channel = `cancel:${taskId}`;
    const handler = () => cb();
    this.emitter.on(channel, handler);
    return async () => {
      this.emitter.removeListener(channel, handler);
    };
  }

  async publishCancel(taskId: string, _sessionId: string): Promise<void> {
    this.emitter.emit(`cancel:${taskId}`);
  }

  // ───────────────────── Misc ─────────────────────

  async destroy(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.emitter.removeAllListeners();
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }

  purgeExpired(): number {
    try {
      const res = this.prepared().cleanup.run(Date.now());
      return res.changes;
    } catch (err) {
      this.logger?.warn?.('[SqliteTaskStore] purgeExpired failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  private rowToRecord(row: TaskRow): TaskRecord {
    const plaintext = this.encryptionKey ? decryptValue(this.encryptionKey, row.record_json) : row.record_json;
    return JSON.parse(plaintext) as TaskRecord;
  }

  /**
   * Serialize + optionally encrypt a TaskRecord before it lands in the DB.
   * Only the `record_json` column is encrypted; indexed columns stay plaintext.
   */
  private serializeRecord(record: TaskRecord): string {
    const json = JSON.stringify(record);
    return this.encryptionKey ? encryptValue(this.encryptionKey, json) : json;
  }
}

// ───────────────────── Cursor (cross-platform base64url) ─────────────────────

function encodeCursor(offset: number): string {
  return toB64Url(new TextEncoder().encode(JSON.stringify({ offset })));
}

function decodeCursor(cursor: string): number {
  try {
    const bytes = fromB64Url(cursor);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed?.offset === 'number' && parsed.offset >= 0 && Number.isInteger(parsed.offset)) {
      return parsed.offset;
    }
  } catch {
    /* fall through */
  }
  return 0;
}

function toB64Url(data: Uint8Array): string {
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(data).toString('base64')
      : btoa(Array.from(data, (b) => String.fromCodePoint(b)).join(''));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64Url(data: string): Uint8Array {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.codePointAt(0) ?? 0);
}
