/**
 * @frontmcp/storage-sqlite
 *
 * SQLite storage backend for FrontMCP.
 * Provides local session, elicitation, and event persistence without Redis.
 */

export { SqliteKvStore } from './sqlite-kv.store';
export { SqliteStorageAdapter } from './sqlite-storage.adapter';
export { openDatabase, withBusyRetry } from './open-database';
export type { OpenDatabaseOptions, BusyRetryOptions } from './open-database';
export { loadBetterSqlite3 } from './better-sqlite3-loader';
export { SqliteSessionStore } from './sqlite-session.store';
export type { SqliteSessionStoreOptions, SessionStoreInterface, StoredSessionData } from './sqlite-session.store';
export { SqliteElicitationStore } from './sqlite-elicitation.store';
export type { SqliteElicitationStoreOptions, ElicitationStoreInterface } from './sqlite-elicitation.store';
export { SqliteTaskStore } from './sqlite-task.store';
export type {
  SqliteTaskStoreOptions,
  TaskStoreInterface,
  TaskRecord as SqliteTaskRecord,
  TaskStatus as SqliteTaskStatus,
  TaskOutcome as SqliteTaskOutcome,
  TaskListPage as SqliteTaskListPage,
  ProcessLivenessProbe,
  SqliteTaskLogger,
} from './sqlite-task.store';
export { SqliteEventStore } from './sqlite-event.store';
export type { SqliteEventStoreOptions, EventStoreInterface } from './sqlite-event.store';
export { deriveEncryptionKey, encryptValue, decryptValue, SqliteDecryptionError } from './encryption';
export { sqliteStorageOptionsSchema } from './sqlite.options';
export type { SqliteStorageOptions, SqliteStorageOptionsInput, SqliteStorageOptionsParsed } from './sqlite.options';
