/**
 * Task types for MCP 2025-11-25 background tasks support.
 *
 * See: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
 *
 * All protocol-facing Zod schemas are re-exported from `@frontmcp/protocol`,
 * which is the single boundary between FrontMCP internals and the upstream
 * MCP protocol package. This module defines the server-side record shape
 * used by the TaskStore and runtime.
 *
 * @module task/task.types
 */

import type { CallToolResult, TaskStatus } from '@frontmcp/protocol';

/**
 * Default task configuration values, used when the server doesn't set them
 * and clients don't request specific values.
 */
export const TASK_DEFAULTS = {
  defaultTtlMs: 3_600_000, // 1 hour
  maxTtlMs: 86_400_000, // 24 hours
  defaultPollIntervalMs: 2_000,
  maxConcurrentPerSession: 16,
} as const;

/**
 * The `io.modelcontextprotocol/related-task` _meta key per MCP spec.
 */
export const RELATED_TASK_META_KEY = 'io.modelcontextprotocol/related-task' as const;

/**
 * The JSON-RPC shape we persist when the underlying request completed with an
 * error. `tasks/result` MUST return exactly this error to the client.
 */
export interface TaskJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * Terminal outcome of a task, captured once the underlying request finishes.
 * `kind` discriminates between a successful result payload (for a tools/call task
 * this is a `CallToolResult`) and a JSON-RPC error.
 */
export type TaskOutcome = { kind: 'ok'; data: CallToolResult } | { kind: 'error'; error: TaskJsonRpcError };

/**
 * The record persisted in the TaskStore. Keyed by `(sessionId, taskId)`.
 *
 * `status` follows the MCP lifecycle: `working` ↔ `input_required` → terminal
 * (`completed` | `failed` | `cancelled`). Transitions are enforced at the
 * flow/runtime layer, not by the store.
 */
export interface TaskRecord {
  /** Cryptographically-secure, receiver-generated identifier. */
  taskId: string;

  /** Auth context binding — tasks are only visible within their owning session. */
  sessionId: string;

  /** Current state of the task execution. */
  status: TaskStatus;

  /** Optional human-readable status string (used for failures, cancellations). */
  statusMessage?: string;

  /** ISO 8601 timestamp when the task was created. */
  createdAt: string;

  /** ISO 8601 timestamp of the last state transition. */
  lastUpdatedAt: string;

  /**
   * Task lifetime in milliseconds from creation. `null` means unlimited (server
   * may still delete at its discretion). The receiver MAY clamp a client's
   * requested TTL down to `TasksConfig.maxTtlMs`.
   */
  ttlMs: number | null;

  /** Suggested polling interval in milliseconds (hint to the client). */
  pollIntervalMs?: number;

  /** Absolute epoch ms after which the store may delete this record. */
  expiresAt: number;

  /**
   * The JSON-RPC method + params this task is wrapping. Only `tools/call` is
   * supported in this iteration (see roadmap).
   */
  request: {
    method: 'tools/call';
    params: Record<string, unknown>;
  };

  /**
   * Populated once `status` reaches a terminal state. Undefined while the task
   * is `working` or `input_required`.
   */
  outcome?: TaskOutcome;

  /**
   * Progress token carried from the request's `_meta`. Remains valid for the
   * duration of the task per spec.
   */
  progressToken?: string | number;

  /**
   * Identifies the runtime executing the task so we can orphan-detect and
   * cross-process cancel.
   *
   * - `host: 'in-process'` — the same Node server that created the task.
   * - `host: 'cli'`        — a detached child process spawned by `CliTaskRunner`.
   *   `pid` is the child's PID; `spawnedAt` the launch timestamp.
   */
  executor?: {
    host: 'in-process' | 'cli';
    pid?: number;
    spawnedAt?: string;
  };
}

/**
 * Projection of a TaskRecord to the MCP `Task` wire shape (what `tasks/get`,
 * `tasks/list`, and `CreateTaskResult.task` return).
 */
export interface TaskWireShape {
  taskId: string;
  status: TaskStatus;
  ttl: number | null;
  createdAt: string;
  lastUpdatedAt: string;
  pollInterval?: number;
  statusMessage?: string;
}

export function toWireShape(record: TaskRecord): TaskWireShape {
  const wire: TaskWireShape = {
    taskId: record.taskId,
    status: record.status,
    ttl: record.ttlMs,
    createdAt: record.createdAt,
    lastUpdatedAt: record.lastUpdatedAt,
  };
  if (record.pollIntervalMs !== undefined) wire.pollInterval = record.pollIntervalMs;
  if (record.statusMessage !== undefined) wire.statusMessage = record.statusMessage;
  return wire;
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Server-side configuration for the tasks subsystem. Wired in `@FrontMcp({ tasks: ... })`.
 */
export interface TasksConfig {
  /** Enable tasks. Defaults to true when any tool declares execution.taskSupport. */
  enabled?: boolean;

  /** Default TTL (ms) when the client doesn't request one. */
  defaultTtlMs?: number;

  /** Hard cap on TTL; client-requested values above this are clamped down. */
  maxTtlMs?: number;

  /** Suggested poll interval reported to clients. */
  defaultPollIntervalMs?: number;

  /** Maximum concurrent task records per session. */
  maxConcurrentPerSession?: number;

  /** Key prefix for the store. Default: 'mcp:task:'. */
  keyPrefix?: string;

  /**
   * Throw at startup instead of warning when the runtime cannot run tasks
   * reliably (edge/serverless with the in-process runner). Default `false`.
   */
  strict?: boolean;

  /**
   * Runner selection:
   *  - `'in-process'` (default): tasks run on the current Node event loop.
   *    Ideal for long-lived servers.
   *  - `'cli'`: tasks run in a detached child process spawned by the current
   *    executable. Required when the parent process cannot guarantee it'll
   *    outlive the task (short-lived CLI hosts, per-request serverless with
   *    a queue fronting it, etc.). MUST pair with a persistent `tasks.sqlite`
   *    or `tasks.redis` backend so the worker and host can read each other's
   *    state.
   */
  runner?: 'in-process' | 'cli';

  /**
   * SQLite task-store options. When set, the task store is backed by SQLite
   * instead of the default @frontmcp/utils memory/Redis/Upstash storage.
   * This is the only option that survives across CLI invocations.
   */
  sqlite?: {
    /** Path to the SQLite database file. */
    path: string;
    /** Optional encryption secret (derives AES-256 key). */
    encryption?: { secret: string };
    /** Enable WAL journal mode. Default: `true`. */
    walMode?: boolean;
    /** Periodic TTL cleanup interval in ms. Default: 60000. */
    ttlCleanupIntervalMs?: number;
  };

  /**
   * Command used by the CLI task runner to spawn detached child processes.
   * When unset, the runner attempts to re-invoke the currently-running
   * executable (`process.argv[0]` + `process.argv[1]`).
   *
   * Override when the FrontMCP entrypoint isn't on the default argv — e.g.,
   * in tests or bundled CLI distributions.
   *
   * Example:
   * ```ts
   * cliRunnerCommand: { exe: 'node', args: ['./dist/server.js'] }
   * ```
   */
  cliRunnerCommand?: {
    exe: string;
    args?: string[];
  };
}
