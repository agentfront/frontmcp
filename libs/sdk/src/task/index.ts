/**
 * @frontmcp/sdk task module — MCP 2025-11-25 background tasks support.
 *
 * See: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
 *
 * @module task
 */

export * from './task.types';
export * from './store';
export { TaskRegistry, type TaskCapabilityInputs } from './task.registry';
export { computeTaskCapabilities } from './task-scope.helper';
export { TaskNotifier } from './helpers/task-notifier';
export { generateTaskId } from './helpers/task-id';
export { runTaskInBackground, type RunTaskParams, type TaskRunnerScope } from './helpers/task-runner';
export type { TaskRunner, SpawnContext } from './helpers/task-runner.types';
export { InProcessTaskRunner, type InProcessTaskRunnerDeps } from './helpers/in-process-task-runner';
export {
  CliTaskRunner,
  type CliTaskRunnerDeps,
  type CliTaskRunnerCommand,
  RUN_TASK_SUBCOMMAND,
  RUN_TASK_ENV_VAR,
} from './helpers/cli-task-runner';
export { isAlive } from './helpers/process-liveness';
// NOTE: `executeTaskWorker` intentionally NOT re-exported here — it imports
// FrontMcpInstance, which pulls in the full scope/transport graph and creates
// a cycle when `task/` is imported from `transport.local.adapter`. Consumers
// should `import` it directly from `@frontmcp/sdk/task/runtime/execute-task`.
export { isTaskWorkerProcess, TASK_WORKER_MODE_FLAG } from './runtime/execute-task-flag';
// Flow classes register themselves via @Flow decorator when imported.
export { default as TasksGetFlow } from './flows/tasks-get.flow';
export { default as TasksResultFlow } from './flows/tasks-result.flow';
export { default as TasksCancelFlow } from './flows/tasks-cancel.flow';
export { default as TasksListFlow } from './flows/tasks-list.flow';
