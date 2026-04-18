/**
 * Small helpers for the task-worker mode that can be safely imported by any
 * layer without pulling the full FrontMcpInstance graph (which would otherwise
 * create a cycle via scope → transport → task → execute-task → front-mcp).
 *
 * @module task/runtime/execute-task-flag
 */

import { RUN_TASK_ENV_VAR } from '../helpers/cli-task-runner';

export const TASK_WORKER_MODE_FLAG = '__taskWorkerMode' as const;

/** True when this process was launched as a task worker. */
export function isTaskWorkerProcess(): boolean {
  return typeof process !== 'undefined' && process.env?.[RUN_TASK_ENV_VAR] !== undefined;
}
