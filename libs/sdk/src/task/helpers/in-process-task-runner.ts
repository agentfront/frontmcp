/**
 * In-process task runner — dispatches the task via a microtask on the current
 * Node event loop. The default runner for long-lived servers.
 *
 * @module task/helpers/in-process-task-runner
 */

import type { FrontMcpLogger } from '../../common';
import type { TaskStore } from '../store';
import type { TaskRegistry } from '../task.registry';
import type { TaskRecord } from '../task.types';
import type { TaskNotifier } from './task-notifier';
import { runTaskInBackground, type TaskRunnerScope } from './task-runner';
import type { SpawnContext, TaskRunner } from './task-runner.types';

export interface InProcessTaskRunnerDeps {
  scope: TaskRunnerScope;
  store: TaskStore;
  registry: TaskRegistry;
  notifier: TaskNotifier;
  logger?: FrontMcpLogger;
}

export class InProcessTaskRunner implements TaskRunner {
  readonly kind = 'in-process' as const;

  constructor(private readonly deps: InProcessTaskRunnerDeps) {}

  async run(record: TaskRecord, context: SpawnContext): Promise<void> {
    // Tag the record with the host so tasks/cancel can route correctly.
    await this.deps.store.update(record.taskId, record.sessionId, {
      executor: { host: 'in-process', spawnedAt: new Date().toISOString() },
    });
    void runTaskInBackground({
      record,
      cleanedRequestParams: context.cleanedRequestParams,
      ctx: context.ctx,
      scope: this.deps.scope,
      store: this.deps.store,
      registry: this.deps.registry,
      notifier: this.deps.notifier,
      logger: this.deps.logger,
    });
  }

  async cancel(record: TaskRecord): Promise<void> {
    // Fire the AbortController for a task running on this node, best-effort.
    this.deps.registry.abort(record.taskId, 'tasks/cancel');
  }
}
