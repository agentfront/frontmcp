/**
 * CLI task runner — spawns a detached worker process that executes the tool
 * and writes the terminal outcome back to the persistent store.
 *
 * The worker is launched via `frontmcp __run-task <taskId>` using either:
 *   1. An explicit `tasks.cliRunnerCommand` override, or
 *   2. The currently-running executable (`argv[0]` + `argv[1]`),
 *   3. Falling back to `node <entrypoint>`.
 *
 * Cancellation uses `process.kill(pid, SIGTERM)`. The worker is expected to
 * observe the signal via the AbortSignal surfaced on `ToolContext.signal`.
 *
 * @module task/helpers/cli-task-runner
 */

import { spawn } from 'node:child_process';

import type { FrontMcpLogger } from '../../common';
import type { TaskStore } from '../store';
import type { TaskRecord } from '../task.types';
import { isAlive } from './process-liveness';
import type { SpawnContext, TaskRunner } from './task-runner.types';

export interface CliTaskRunnerCommand {
  exe: string;
  args?: string[];
}

export interface CliTaskRunnerDeps {
  store: TaskStore;
  /** Explicit command override. When omitted, the runner uses `argv[0]`+`argv[1]`. */
  command?: CliTaskRunnerCommand;
  logger?: FrontMcpLogger;
}

const RUN_TASK_SUBCOMMAND = '__run-task';
const RUN_TASK_ENV_VAR = 'FRONTMCP_RUN_TASK_ID';

export class CliTaskRunner implements TaskRunner {
  readonly kind = 'cli' as const;

  constructor(private readonly deps: CliTaskRunnerDeps) {}

  async run(record: TaskRecord, _context: SpawnContext): Promise<void> {
    const { exe, args } = this.resolveCommand();
    const fullArgs = [...args, RUN_TASK_SUBCOMMAND, record.taskId];

    this.deps.logger?.info('[CliTaskRunner] spawning detached worker', {
      taskId: record.taskId,
      exe,
      args: fullArgs,
    });

    const child = spawn(exe, fullArgs, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [RUN_TASK_ENV_VAR]: record.taskId },
    });

    // Node emits 'error' on ENOENT / EACCES etc. Without a listener this becomes
    // an uncaught exception. Mark the task failed so a polling client sees a
    // terminal state instead of a record stuck in `working`.
    child.on('error', (err) => {
      this.deps.logger?.error('[CliTaskRunner] worker spawn failed', {
        taskId: record.taskId,
        exe,
        error: err instanceof Error ? err.message : String(err),
      });
      void this.markBootstrapFailure(record, err instanceof Error ? err.message : String(err));
    });

    // Let the parent exit independently of the child.
    child.unref();

    if (typeof child.pid !== 'number') {
      const reason = 'spawn produced no PID';
      this.deps.logger?.error('[CliTaskRunner] worker spawn failed', { taskId: record.taskId, reason });
      await this.markBootstrapFailure(record, reason);
      return;
    }

    await this.deps.store.update(record.taskId, record.sessionId, {
      executor: {
        host: 'cli',
        pid: child.pid,
        spawnedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Transition a task to `failed` when we couldn't even get a worker off the
   * ground. Publishes the terminal event so any `tasks/result` waiter is
   * unblocked, and is best-effort (a failing store write is only logged).
   */
  private async markBootstrapFailure(record: TaskRecord, reason: string): Promise<void> {
    try {
      const failed = await this.deps.store.update(record.taskId, record.sessionId, {
        status: 'failed',
        statusMessage: `Task runner failed to start worker: ${reason}`,
        outcome: { kind: 'error', error: { code: -32603, message: reason } },
      });
      if (failed) {
        try {
          await this.deps.store.publishTerminal(failed);
        } catch {
          // best effort — already logged by the store
        }
      }
    } catch (err) {
      this.deps.logger?.warn?.('[CliTaskRunner] bootstrap-failure bookkeeping write failed', {
        taskId: record.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async cancel(record: TaskRecord): Promise<void> {
    const pid = record.executor?.pid;
    if (!pid || !isAlive(pid)) {
      this.deps.logger?.debug?.('[CliTaskRunner] cancel: worker already dead', {
        taskId: record.taskId,
        pid,
      });
      return;
    }
    try {
      process.kill(pid, 'SIGTERM');
      this.deps.logger?.info('[CliTaskRunner] sent SIGTERM to worker', { taskId: record.taskId, pid });
    } catch (err) {
      // Treat a missing process as success — the runner is already gone.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ESRCH') {
        this.deps.logger?.warn('[CliTaskRunner] failed to SIGTERM worker', {
          taskId: record.taskId,
          pid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private resolveCommand(): { exe: string; args: string[] } {
    const explicit = this.deps.command;
    if (explicit) return { exe: explicit.exe, args: [...(explicit.args ?? [])] };
    // argv[0] is typically node; argv[1] the entrypoint script. Re-invoke
    // ourselves so the worker loads the same app config as the parent.
    const exe = process.argv[0] ?? 'node';
    const entry = process.argv[1];
    if (!entry) {
      throw new Error(
        '[CliTaskRunner] cannot resolve worker command: process.argv[1] is empty and no `tasks.cliRunnerCommand` override was set',
      );
    }
    // Node can't execute TypeScript sources directly. When the parent is
    // running under tsx (entry ends in .ts / .tsx / .mts / .cts), re-invoke
    // via `npx tsx` so the worker boots the same code path.
    if (/\.(ts|tsx|mts|cts)$/i.test(entry)) {
      return { exe: 'npx', args: ['tsx', entry] };
    }
    return { exe, args: [entry] };
  }
}

export { RUN_TASK_SUBCOMMAND, RUN_TASK_ENV_VAR };
