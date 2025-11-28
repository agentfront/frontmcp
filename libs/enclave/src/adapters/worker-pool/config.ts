/**
 * Worker Pool Configuration
 *
 * Types and presets for the worker pool adapter.
 *
 * @packageDocumentation
 */

import os from 'os';
import type { SecurityLevel } from '../../types';

/**
 * Worker pool configuration options
 */
export interface WorkerPoolConfig {
  /**
   * Minimum number of warm workers to keep in the pool
   * @default 2
   */
  minWorkers: number;

  /**
   * Maximum number of workers in the pool
   * @default os.cpus().length
   */
  maxWorkers: number;

  /**
   * Memory limit per worker in bytes
   * Workers exceeding this limit will be recycled
   * @default 128 * 1024 * 1024 (128MB)
   */
  memoryLimitPerWorker: number;

  /**
   * Interval between memory checks in milliseconds
   * @default 1000
   */
  memoryCheckIntervalMs: number;

  /**
   * Maximum number of executions before a worker is recycled
   * Helps prevent memory leaks from accumulating
   * @default 1000
   */
  maxExecutionsPerWorker: number;

  /**
   * Time in milliseconds before an idle worker is released
   * @default 30000
   */
  idleTimeoutMs: number;

  /**
   * Maximum time to wait in the execution queue
   * @default 30000
   */
  queueTimeoutMs: number;

  /**
   * Maximum number of pending executions in the queue
   * @default 100
   */
  maxQueueSize: number;

  /**
   * Time to wait for graceful shutdown before force terminating workers
   * @default 5000
   */
  gracefulShutdownTimeoutMs: number;

  /**
   * Maximum messages per second allowed from a single worker
   * Prevents message flooding attacks
   * @default 1000
   */
  maxMessagesPerSecond: number;

  /**
   * Maximum concurrent pending tool calls per execution
   * @default 100
   */
  maxPendingToolCalls: number;

  /**
   * Maximum size of a single message in bytes
   * @default 16 * 1024 * 1024 (16MB)
   */
  maxMessageSizeBytes: number;

  /**
   * Whether to warm up the pool on initialization
   * @default true
   */
  warmOnInit: boolean;
}

/**
 * Worker slot status
 */
export type WorkerSlotStatus = 'created' | 'idle' | 'executing' | 'recycling' | 'terminating' | 'terminated';

/**
 * Resource usage reported by a worker
 */
export interface ResourceUsage {
  /** Resident set size in bytes */
  rss: number;
  /** Total V8 heap allocated in bytes */
  heapTotal: number;
  /** V8 heap actually used in bytes */
  heapUsed: number;
  /** External memory (Buffers, etc.) in bytes */
  external: number;
  /** ArrayBuffer memory in bytes */
  arrayBuffers: number;
}

/**
 * Worker pool metrics snapshot
 */
export interface WorkerPoolMetrics {
  /** Current timestamp */
  timestamp: number;
  /** Total slots in pool */
  totalSlots: number;
  /** Idle slots */
  idleSlots: number;
  /** Slots currently executing */
  executingSlots: number;
  /** Slots being recycled */
  recyclingSlots: number;
  /** Requests waiting in queue */
  queuedRequests: number;
  /** Total executions since start */
  totalExecutions: number;
  /** Successful executions */
  successfulExecutions: number;
  /** Failed executions */
  failedExecutions: number;
  /** Executions that timed out */
  timeoutExecutions: number;
  /** Workers killed due to memory limit */
  memoryKills: number;
  /** Workers force terminated */
  forcedTerminations: number;
  /** Workers recycled (any reason) */
  workerRecycles: number;
  /** Average execution time in milliseconds */
  avgExecutionTimeMs: number;
  /** Average worker memory usage in bytes */
  avgWorkerMemory: number;
  /** Peak worker memory usage in bytes */
  maxWorkerMemory: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_WORKER_POOL_CONFIG: WorkerPoolConfig = {
  minWorkers: 2,
  maxWorkers: os.cpus().length,
  memoryLimitPerWorker: 128 * 1024 * 1024, // 128MB
  memoryCheckIntervalMs: 1000,
  maxExecutionsPerWorker: 1000,
  idleTimeoutMs: 30000,
  queueTimeoutMs: 30000,
  maxQueueSize: 100,
  gracefulShutdownTimeoutMs: 5000,
  maxMessagesPerSecond: 1000,
  maxPendingToolCalls: 100,
  maxMessageSizeBytes: 16 * 1024 * 1024, // 16MB
  warmOnInit: true,
};

/**
 * Worker pool configuration presets aligned with security levels
 */
export const WORKER_POOL_PRESETS: Record<SecurityLevel, Partial<WorkerPoolConfig>> = {
  /**
   * STRICT: Maximum security, minimal resources
   * - Tight memory limits (64MB)
   * - Fast recycling (100 executions)
   * - Low message rate limits
   * - Small message size limits
   */
  STRICT: {
    minWorkers: 2,
    maxWorkers: 4,
    memoryLimitPerWorker: 64 * 1024 * 1024, // 64MB
    memoryCheckIntervalMs: 500,
    maxExecutionsPerWorker: 100,
    idleTimeoutMs: 15000,
    queueTimeoutMs: 10000,
    maxQueueSize: 20,
    gracefulShutdownTimeoutMs: 2000,
    maxMessagesPerSecond: 100,
    maxPendingToolCalls: 10,
    maxMessageSizeBytes: 1 * 1024 * 1024, // 1MB
  },

  /**
   * SECURE: Balanced security with reasonable resources
   * - Moderate memory limits (128MB)
   * - Standard recycling (500 executions)
   * - Medium message rate limits
   */
  SECURE: {
    minWorkers: 2,
    maxWorkers: 8,
    memoryLimitPerWorker: 128 * 1024 * 1024, // 128MB
    memoryCheckIntervalMs: 1000,
    maxExecutionsPerWorker: 500,
    idleTimeoutMs: 30000,
    queueTimeoutMs: 20000,
    maxQueueSize: 50,
    gracefulShutdownTimeoutMs: 3000,
    maxMessagesPerSecond: 500,
    maxPendingToolCalls: 50,
    maxMessageSizeBytes: 4 * 1024 * 1024, // 4MB
  },

  /**
   * STANDARD: Default settings for trusted environments
   * - Higher memory limits (256MB)
   * - Longer recycling intervals (1000 executions)
   * - Higher message throughput
   */
  STANDARD: {
    minWorkers: 2,
    maxWorkers: 16,
    memoryLimitPerWorker: 256 * 1024 * 1024, // 256MB
    memoryCheckIntervalMs: 1000,
    maxExecutionsPerWorker: 1000,
    idleTimeoutMs: 30000,
    queueTimeoutMs: 30000,
    maxQueueSize: 100,
    gracefulShutdownTimeoutMs: 5000,
    maxMessagesPerSecond: 1000,
    maxPendingToolCalls: 100,
    maxMessageSizeBytes: 16 * 1024 * 1024, // 16MB
  },

  /**
   * PERMISSIVE: Maximum performance for fully trusted code
   * - Large memory limits (512MB)
   * - Long-lived workers (5000 executions)
   * - High message throughput
   */
  PERMISSIVE: {
    minWorkers: 4,
    maxWorkers: 32,
    memoryLimitPerWorker: 512 * 1024 * 1024, // 512MB
    memoryCheckIntervalMs: 2000,
    maxExecutionsPerWorker: 5000,
    idleTimeoutMs: 60000,
    queueTimeoutMs: 60000,
    maxQueueSize: 500,
    gracefulShutdownTimeoutMs: 10000,
    maxMessagesPerSecond: 5000,
    maxPendingToolCalls: 1000,
    maxMessageSizeBytes: 64 * 1024 * 1024, // 64MB
  },
};

/**
 * Build the effective configuration from defaults, preset, and overrides
 */
export function buildWorkerPoolConfig(
  securityLevel: SecurityLevel,
  overrides?: Partial<WorkerPoolConfig>,
): WorkerPoolConfig {
  const preset = WORKER_POOL_PRESETS[securityLevel];
  return {
    ...DEFAULT_WORKER_POOL_CONFIG,
    ...preset,
    ...overrides,
  };
}
