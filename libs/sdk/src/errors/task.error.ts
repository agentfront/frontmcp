/**
 * Task-related errors for MCP 2025-11-25 background tasks.
 *
 * Per spec §Error Handling, task operations MUST use the following JSON-RPC
 * error codes:
 *  - `-32602` (Invalid params): unknown/expired taskId on get/result/cancel,
 *                                attempting to cancel a terminal task,
 *                                invalid cursor on list.
 *  - `-32601` (Method not found): tool-level `taskSupport` violation on
 *                                  a task-augmented `tools/call`, or a
 *                                  non-task-augmented call against a tool
 *                                  whose `taskSupport` is `'required'`.
 *  - `-32603` (Internal error): task subsystem misconfigured (store missing).
 *
 * @module errors/task.error
 */

import { InternalMcpError, MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

export class TaskNotFoundError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;
  constructor(taskId: string) {
    super(`Failed to retrieve task: Task not found`, 'TASK_NOT_FOUND', 400);
    // Avoid echoing the taskId in the public message per security guidance —
    // unknown IDs should all look the same to callers.
    this.taskId = taskId;
  }
  readonly taskId: string;
  toJsonRpcError(): { code: number; message: string } {
    return { code: this.mcpErrorCode, message: this.getPublicMessage() };
  }
}

export class TaskAlreadyTerminalError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;
  constructor(status: string) {
    super(`Cannot cancel task: already in terminal status '${status}'`, 'TASK_ALREADY_TERMINAL', 400);
    this.status = status;
  }
  readonly status: string;
  toJsonRpcError(): { code: number; message: string } {
    return { code: this.mcpErrorCode, message: this.getPublicMessage() };
  }
}

export class TaskAugmentationNotSupportedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.METHOD_NOT_FOUND;
  constructor(toolName: string) {
    super(`Tool "${toolName}" does not support task-augmented invocation`, 'TASK_AUGMENTATION_NOT_SUPPORTED', 404);
  }
  toJsonRpcError(): { code: number; message: string } {
    return { code: this.mcpErrorCode, message: this.getPublicMessage() };
  }
}

export class TaskAugmentationRequiredError extends PublicMcpError {
  // Per MCP 2025-11-25 §Tool-Level Negotiation: tool-level `taskSupport: "required"`
  // without task augmentation MUST return -32601 (Method not found).
  readonly mcpErrorCode = MCP_ERROR_CODES.METHOD_NOT_FOUND;
  constructor(toolName: string) {
    super(`Tool "${toolName}" requires task-augmented invocation`, 'TASK_AUGMENTATION_REQUIRED', 404);
  }
  toJsonRpcError(): { code: number; message: string } {
    return { code: this.mcpErrorCode, message: this.getPublicMessage() };
  }
}

export class TaskStoreNotInitializedError extends InternalMcpError {
  constructor() {
    super('Task store is not initialized', 'TASK_STORE_NOT_INITIALIZED');
  }
}
