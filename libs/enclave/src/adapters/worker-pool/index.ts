/**
 * Worker Pool Adapter
 *
 * Provides a worker thread-based sandbox adapter with:
 * - OS-level memory isolation
 * - Hard halt capability via worker.terminate()
 * - Pool management with min/max workers
 * - Memory monitoring and enforcement
 * - Rate limiting for message flood protection
 *
 * @packageDocumentation
 */

// Main adapter
export { WorkerPoolAdapter } from './worker-pool-adapter';

// Configuration
export {
  WorkerPoolConfig,
  WorkerSlotStatus,
  ResourceUsage,
  WorkerPoolMetrics,
  DEFAULT_WORKER_POOL_CONFIG,
  WORKER_POOL_PRESETS,
  buildWorkerPoolConfig,
} from './config';

// Errors
export {
  WorkerPoolError,
  WorkerTimeoutError,
  WorkerMemoryError,
  WorkerCrashedError,
  WorkerPoolDisposedError,
  QueueFullError,
  QueueTimeoutError,
  ExecutionAbortedError,
  MessageFloodError,
  MessageValidationError,
  MessageSizeError,
  WorkerStartupError,
  TooManyPendingCallsError,
} from './errors';

// Protocol types
export type {
  SerializedError,
  SerializedConfig,
  WorkerExecutionStats,
  MainToWorkerMessage,
  WorkerToMainMessage,
  ExecuteMessage,
  ToolCallMessage,
  ExecutionResultMessage,
  ToolResponseMessage,
} from './protocol';

// Utility exports for advanced usage
export { WorkerSlot } from './worker-slot';
export { ExecutionQueue, QueueStats } from './execution-queue';
export { MemoryMonitor, MemoryMonitorStats } from './memory-monitor';
export { RateLimiter, createRateLimiter } from './rate-limiter';
export { safeDeserialize, safeSerialize, sanitizeObject } from './safe-deserialize';
