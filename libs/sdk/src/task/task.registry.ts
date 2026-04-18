/**
 * TaskRegistry — in-process bookkeeping for background task execution.
 *
 * Responsibilities:
 *  - Track AbortControllers for tasks currently running on this node so that
 *    `tasks/cancel` can signal them synchronously without a round-trip.
 *  - Compute the server's `tasks` capability for the MCP `initialize` response.
 *
 * Cross-node cancel signalling (when the cancel request lands on a different
 * node than the one running the task) is handled by `TaskStore.subscribeCancel`
 * + `publishCancel`, which is wired in `task-runner.ts`.
 *
 * @module task/task.registry
 */

import type { ServerCapabilities } from '@frontmcp/protocol';

import type { FrontMcpLogger } from '../common';
import type { TaskRunner } from './helpers/task-runner.types';
import type { TasksConfig } from './task.types';

/**
 * Snapshot the registry uses to decide whether to advertise the `tasks`
 * capability. Kept minimal so it can be refreshed cheaply when tool metadata
 * changes.
 */
export interface TaskCapabilityInputs {
  /**
   * Whether any currently-registered tool declares `execution.taskSupport` other
   * than `'forbidden'`. When false, the server does not advertise task support.
   */
  hasTaskEnabledTool: boolean;
  /**
   * Whether the current auth context can identify requestors. When false, the
   * `tasks.list` capability is suppressed per spec §Security.
   */
  canIdentifyRequestors: boolean;
}

export class TaskRegistry {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly logger?: FrontMcpLogger;
  private readonly config: TasksConfig;
  private _runner?: TaskRunner;

  constructor(config: TasksConfig = {}, logger?: FrontMcpLogger) {
    this.config = config;
    this.logger = logger;
  }

  /** Assign the runner used to execute task-augmented tool calls. */
  setRunner(runner: TaskRunner): void {
    this._runner = runner;
  }

  /** Current runner (in-process or CLI), set by the scope during init. */
  get runner(): TaskRunner | undefined {
    return this._runner;
  }

  /** Register an AbortController for a running task on this node. */
  trackRunning(taskId: string): AbortController {
    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);
    return controller;
  }

  /** Untrack a task once it leaves `working`/`input_required`. */
  untrack(taskId: string): void {
    this.abortControllers.delete(taskId);
  }

  /** Returns true if the task is running on this node and abort was fired. */
  abort(taskId: string, reason?: string): boolean {
    const controller = this.abortControllers.get(taskId);
    if (!controller) return false;
    try {
      controller.abort(reason);
    } catch (err) {
      this.logger?.warn('[TaskRegistry] abort failed', {
        taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /** Count currently running tasks (for limits checks). */
  runningCount(): number {
    return this.abortControllers.size;
  }

  /** Access the tasks config for defaults/limits. */
  getConfig(): TasksConfig {
    return this.config;
  }

  /**
   * Compute the MCP server capabilities contribution for tasks per
   * 2025-11-25 §Capabilities.
   *
   * Advertises:
   *   - `tasks.requests.tools.call` — when any tool declares taskSupport.
   *   - `tasks.cancel` — always, when the feature is enabled.
   *   - `tasks.list` — only when requestors can be identified (otherwise
   *     listing would leak task metadata per spec §Security).
   */
  getCapabilities(inputs: TaskCapabilityInputs): Partial<ServerCapabilities> {
    if (this.config.enabled === false) return {};
    if (!inputs.hasTaskEnabledTool) return {};
    const caps: Record<string, unknown> = {
      cancel: {},
      requests: { tools: { call: {} } },
    };
    if (inputs.canIdentifyRequestors) {
      caps['list'] = {};
    }
    return { tasks: caps } as unknown as Partial<ServerCapabilities>;
  }
}
