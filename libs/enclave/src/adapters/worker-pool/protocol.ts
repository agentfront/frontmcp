/**
 * Worker Pool Message Protocol
 *
 * Type definitions for messages exchanged between main thread and worker threads.
 * All messages are JSON-serialized to prevent structured clone attacks.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { ResourceUsage } from './config';

/**
 * Serialized error format for cross-thread communication
 * Errors are serialized to prevent prototype pollution
 */
export interface SerializedError {
  /** Error name/type */
  name: string;
  /** Error message */
  message: string;
  /** Error code if available */
  code?: string;
  /** Sanitized stack trace (only if sanitizeStackTraces is false) */
  stack?: string;
}

/**
 * Execution statistics from the worker
 */
export interface WorkerExecutionStats {
  /** Total execution duration in milliseconds */
  duration: number;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Number of loop iterations */
  iterationCount: number;
  /** Start timestamp */
  startTime: number;
  /** End timestamp */
  endTime: number;
}

/**
 * Serializable configuration sent to worker
 * Excludes non-serializable fields like functions
 */
export interface SerializedConfig {
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Maximum loop iterations */
  maxIterations: number;
  /** Maximum tool calls */
  maxToolCalls: number;
  /** Maximum console output in bytes */
  maxConsoleOutputBytes: number;
  /** Maximum console calls */
  maxConsoleCalls: number;
  /** Whether to sanitize stack traces */
  sanitizeStackTraces: boolean;
  /** Maximum sanitization depth */
  maxSanitizeDepth: number;
  /** Maximum properties per object in sanitized values */
  maxSanitizeProperties: number;
  /** Custom globals (serializable values only) */
  globals?: Record<string, unknown>;
}

// ============================================================================
// Main Thread → Worker Messages
// ============================================================================

/**
 * Execute code in the worker
 */
export interface ExecuteMessage {
  type: 'execute';
  /** Unique request identifier */
  requestId: string;
  /** Code to execute (already transformed) */
  code: string;
  /** Serialized execution config */
  config: SerializedConfig;
}

/**
 * Response to a tool call from the worker
 */
export interface ToolResponseMessage {
  type: 'tool-response';
  /** Original request identifier */
  requestId: string;
  /** Tool call identifier */
  callId: string;
  /** Tool result (if successful) */
  result?: unknown;
  /** Error (if failed) */
  error?: SerializedError;
}

/**
 * Request memory usage report from worker
 */
export interface MemoryReportRequestMessage {
  type: 'memory-report';
}

/**
 * Abort a running execution
 */
export interface AbortMessage {
  type: 'abort';
  /** Request to abort */
  requestId: string;
}

/**
 * Terminate the worker
 */
export interface TerminateMessage {
  type: 'terminate';
  /** Whether to wait for current execution to finish */
  graceful: boolean;
}

/**
 * Union of all messages from main thread to worker
 */
export type MainToWorkerMessage =
  | ExecuteMessage
  | ToolResponseMessage
  | MemoryReportRequestMessage
  | AbortMessage
  | TerminateMessage;

// ============================================================================
// Worker → Main Thread Messages
// ============================================================================

/**
 * Worker is ready to receive executions
 */
export interface WorkerReadyMessage {
  type: 'ready';
}

/**
 * Tool call request from worker
 */
export interface ToolCallMessage {
  type: 'tool-call';
  /** Execution request identifier */
  requestId: string;
  /** Unique identifier for this tool call */
  callId: string;
  /** Name of the tool to call */
  toolName: string;
  /** Arguments for the tool (must be object to match Zod schema) */
  args: Record<string, unknown>;
}

/**
 * Execution result from worker
 */
export interface ExecutionResultMessage {
  type: 'result';
  /** Request identifier */
  requestId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Return value (if successful) */
  value?: unknown;
  /** Error (if failed) */
  error?: SerializedError;
  /** Execution statistics */
  stats: WorkerExecutionStats;
}

/**
 * Memory usage report from worker
 */
export interface MemoryReportResultMessage {
  type: 'memory-report-result';
  /** Memory usage statistics */
  usage: ResourceUsage;
}

/**
 * Console output from worker
 */
export interface ConsoleMessage {
  type: 'console';
  /** Execution request identifier */
  requestId: string;
  /** Console level */
  level: 'log' | 'warn' | 'error' | 'info';
  /** Console arguments */
  args: unknown[];
}

/**
 * Union of all messages from worker to main thread
 */
export type WorkerToMainMessage =
  | WorkerReadyMessage
  | ToolCallMessage
  | ExecutionResultMessage
  | MemoryReportResultMessage
  | ConsoleMessage;

// ============================================================================
// Message Validation Schemas
// ============================================================================

/**
 * Tool name regex pattern
 * Allows: letters, numbers, colons, underscores, hyphens
 * Must start with a letter
 */
const TOOL_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9:_-]*$/;

/**
 * UUID-like pattern for request/call IDs
 */
const ID_PATTERN = /^[a-zA-Z0-9-]+$/;

/**
 * Zod schema for tool call messages
 */
export const toolCallMessageSchema = z
  .object({
    type: z.literal('tool-call'),
    requestId: z.string().min(1).max(100).regex(ID_PATTERN),
    callId: z.string().min(1).max(100).regex(ID_PATTERN),
    toolName: z.string().min(1).max(256).regex(TOOL_NAME_PATTERN),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * Zod schema for execution result messages
 */
export const executionResultMessageSchema = z
  .object({
    type: z.literal('result'),
    requestId: z.string().min(1).max(100).regex(ID_PATTERN),
    success: z.boolean(),
    value: z.unknown().optional(),
    error: z
      .object({
        name: z.string().max(100),
        message: z.string().max(10000),
        code: z.string().max(100).optional(),
        stack: z.string().max(10000).optional(),
      })
      .optional(),
    stats: z.object({
      duration: z.number().nonnegative(),
      toolCallCount: z.number().nonnegative().int(),
      iterationCount: z.number().nonnegative().int(),
      startTime: z.number().nonnegative(),
      endTime: z.number().nonnegative(),
    }),
  })
  .strict();

/**
 * Zod schema for memory report result messages
 */
export const memoryReportResultMessageSchema = z
  .object({
    type: z.literal('memory-report-result'),
    usage: z.object({
      rss: z.number().nonnegative(),
      heapTotal: z.number().nonnegative(),
      heapUsed: z.number().nonnegative(),
      external: z.number().nonnegative(),
      arrayBuffers: z.number().nonnegative(),
    }),
  })
  .strict();

/**
 * Zod schema for console messages
 */
export const consoleMessageSchema = z
  .object({
    type: z.literal('console'),
    requestId: z.string().min(1).max(100).regex(ID_PATTERN),
    level: z.enum(['log', 'warn', 'error', 'info']),
    args: z.array(z.unknown()).max(100),
  })
  .strict();

/**
 * Zod schema for worker ready messages
 */
export const workerReadyMessageSchema = z
  .object({
    type: z.literal('ready'),
  })
  .strict();

/**
 * Union schema for all worker-to-main messages
 */
export const workerToMainMessageSchema = z.discriminatedUnion('type', [
  workerReadyMessageSchema,
  toolCallMessageSchema,
  executionResultMessageSchema,
  memoryReportResultMessageSchema,
  consoleMessageSchema,
]);

/**
 * Type guard for tool call messages
 */
export function isToolCallMessage(msg: WorkerToMainMessage): msg is ToolCallMessage {
  return msg.type === 'tool-call';
}

/**
 * Type guard for execution result messages
 */
export function isExecutionResultMessage(msg: WorkerToMainMessage): msg is ExecutionResultMessage {
  return msg.type === 'result';
}

/**
 * Type guard for memory report result messages
 */
export function isMemoryReportResultMessage(msg: WorkerToMainMessage): msg is MemoryReportResultMessage {
  return msg.type === 'memory-report-result';
}

/**
 * Type guard for console messages
 */
export function isConsoleMessage(msg: WorkerToMainMessage): msg is ConsoleMessage {
  return msg.type === 'console';
}

/**
 * Type guard for worker ready messages
 */
export function isWorkerReadyMessage(msg: WorkerToMainMessage): msg is WorkerReadyMessage {
  return msg.type === 'ready';
}
