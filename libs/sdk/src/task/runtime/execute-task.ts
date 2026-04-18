/**
 * Task-worker entrypoint.
 *
 * Called by the `__run-task <taskId>` CLI subcommand. Loads the user's
 * FrontMCP config, boots a minimal scope (no HTTP transport), looks up the
 * pending task record, runs the tool through the same flow pipeline the
 * Node server would, and exits.
 *
 * The FRONTMCP_RUN_TASK_ID environment variable is set by the parent's
 * `CliTaskRunner` so this module (and `scope.instance.ts`) can detect it is
 * being invoked as a worker rather than as a long-lived server.
 *
 * @module task/runtime/execute-task
 */

import { frontMcpMetadataSchema, type FrontMcpConfigInput, type FrontMcpLogger } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { FileLogTransportInstance } from '../../logger/instances/instance.file-logger';
import type { Scope } from '../../scope/scope.instance';
import { TaskNotifier } from '../helpers/task-notifier';
import { runTaskInBackground } from '../helpers/task-runner';
import { isTerminal } from '../task.types';
import { TASK_WORKER_MODE_FLAG } from './execute-task-flag';

/**
 * Boot the user's FrontMCP config in task-worker mode and run a single task
 * to completion. Returns the exit code the worker should use.
 */
export async function executeTaskWorker(options: FrontMcpConfigInput, taskId: string): Promise<number> {
  // Parse config: no HTTP, file logger only, worker-mode flag so scope.instance
  // enables the task store even though the process is short-lived.
  const parsedConfig = frontMcpMetadataSchema.parse({
    ...options,
    http: undefined,
  });
  (parsedConfig as Record<string, unknown>)[TASK_WORKER_MODE_FLAG] = true;
  // Also mark __cliMode so non-essential registries (UI compilation etc.) are skipped.
  (parsedConfig as Record<string, unknown>)['__cliMode'] = true;

  if (parsedConfig.logging) {
    parsedConfig.logging.enableConsole = false;
    const transports = parsedConfig.logging.transports ?? [];
    if (!transports.includes(FileLogTransportInstance)) transports.push(FileLogTransportInstance);
    parsedConfig.logging.transports = transports;
  } else {
    (parsedConfig as Record<string, unknown>)['logging'] = {
      enableConsole: false,
      transports: [FileLogTransportInstance],
    };
  }

  const instance = new FrontMcpInstance(parsedConfig);
  await instance.ready;

  const [scope] = instance.getScopes() as Scope[];
  if (!scope) return fatal('no scope initialized in task worker', instance);
  const logger = scope.logger.child('task-worker');

  const store = scope.taskStore;
  const registry = scope.tasks;
  if (!store || !registry) {
    return fatal(
      'task worker booted without a task store — did you forget `tasks.sqlite` in config?',
      instance,
      logger,
    );
  }

  // We don't know the sessionId until we read the record. SqliteTaskStore.get
  // requires sessionId; look up by scanning a session-agnostic path. Simplest
  // is a small helper on the store — but to stay within the public interface,
  // fall through by reading the raw SQLite if exposed, otherwise fail loudly.
  const anyStore = store as unknown as {
    getByIdAnySession?: (taskId: string) => Promise<{ sessionId: string } | null>;
    getDatabase?: () => unknown;
  };
  let sessionId: string | undefined;
  if (typeof anyStore.getDatabase === 'function') {
    // SqliteTaskStore exposes the raw DB — run a direct session lookup.
    const db = anyStore.getDatabase() as {
      prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
    };
    const row = db.prepare('SELECT session_id FROM mcp_tasks WHERE task_id = ?').get(taskId) as
      | { session_id: string }
      | undefined;
    sessionId = row?.session_id;
  }
  if (!sessionId) {
    logger.warn('task worker: task record not found', { taskId });
    await shutdownScopeResources(scope);
    return 0; // nothing to do; exit cleanly
  }

  const record = await store.get(taskId, sessionId);
  if (!record) {
    logger.warn('task worker: task record missing after session resolution', { taskId });
    await shutdownScopeResources(scope);
    return 0;
  }
  if (isTerminal(record.status)) {
    logger.info('task worker: record already terminal, nothing to do', {
      taskId,
      status: record.status,
    });
    await shutdownScopeResources(scope);
    return 0;
  }

  // Persist the worker's own PID so `tasks/cancel` from any process knows
  // which OS process to signal.
  await store.update(taskId, sessionId, {
    executor: {
      host: 'cli',
      pid: process.pid,
      spawnedAt: new Date().toISOString(),
    },
  });

  // Wire SIGTERM → AbortController. The in-process TaskRegistry tracks the
  // controller; when the parent sends SIGTERM, we trigger `abort()` on the
  // registry entry so `ToolContext.signal` fires for the running tool.
  const onSignal = () => registry.abort(taskId, 'SIGTERM');
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);

  const notifier = new TaskNotifier(scope.notifications, logger);

  try {
    await runTaskInBackground({
      record,
      cleanedRequestParams: record.request.params,
      ctx: { authInfo: { sessionId } },
      scope: scope as unknown as Parameters<typeof runTaskInBackground>[0]['scope'],
      store,
      registry,
      notifier,
      logger,
    });
    return 0;
  } catch (err) {
    logger.error('task worker: runner threw', {
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
    await shutdownScopeResources(scope);
  }
}

function fatal(message: string, _instance: FrontMcpInstance, logger?: FrontMcpLogger): number {
  if (logger) logger.error(message);
  else console.error(`[task-worker] ${message}`);
  return 2;
}

/**
 * Best-effort cleanup of long-lived scope resources before the worker exits.
 * Node's process exit will reclaim file descriptors anyway, but explicitly
 * destroying the store also flushes any pending writes.
 */
async function shutdownScopeResources(scope: Scope): Promise<void> {
  const storeAny = scope.taskStore as unknown as { destroy?: () => Promise<void> } | undefined;
  if (storeAny?.destroy) {
    try {
      await storeAny.destroy();
    } catch {
      /* ignore */
    }
  }
}
