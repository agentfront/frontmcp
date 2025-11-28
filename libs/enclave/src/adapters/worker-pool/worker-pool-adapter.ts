/**
 * Worker Pool Adapter
 *
 * Implements the SandboxAdapter interface using a pool of worker threads.
 * Provides OS-level memory isolation, hard halt capability, and full pool management.
 *
 * @packageDocumentation
 */

import crypto from 'crypto';
import type { SandboxAdapter, ExecutionContext, ExecutionResult, SecurityLevel } from '../../types';
import type { WorkerPoolConfig, ResourceUsage, WorkerPoolMetrics } from './config';
import { buildWorkerPoolConfig, DEFAULT_WORKER_POOL_CONFIG } from './config';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  ExecutionResultMessage,
  ToolCallMessage,
  SerializedConfig,
  SerializedError,
} from './protocol';
import { isToolCallMessage, isExecutionResultMessage, isConsoleMessage } from './protocol';
import { WorkerSlot } from './worker-slot';
import { ExecutionQueue } from './execution-queue';
import { MemoryMonitor } from './memory-monitor';
import { RateLimiter, createRateLimiter } from './rate-limiter';
import { safeDeserialize, sanitizeObject } from './safe-deserialize';
import {
  WorkerPoolDisposedError,
  WorkerTimeoutError,
  WorkerMemoryError,
  MessageValidationError,
  TooManyPendingCallsError,
  QueueFullError,
} from './errors';

/**
 * Worker Pool Adapter
 *
 * Provides a worker thread-based sandbox adapter with:
 * - OS-level memory isolation
 * - Hard halt capability via worker.terminate()
 * - Pool management with min/max workers
 * - Memory monitoring and enforcement
 * - Rate limiting for message flood protection
 */
export class WorkerPoolAdapter implements SandboxAdapter {
  private readonly config: Required<WorkerPoolConfig>;
  private readonly securityLevel: SecurityLevel;
  private readonly slots = new Map<string, WorkerSlot>();
  private readonly executionQueue: ExecutionQueue;
  private readonly memoryMonitor: MemoryMonitor;
  private readonly rateLimiter: RateLimiter;
  private disposed = false;
  private initialized = false;

  // Metrics
  private _totalExecutions = 0;
  private _successfulExecutions = 0;
  private _failedExecutions = 0;
  private _timeoutExecutions = 0;
  private _workerRecycles = 0;
  private _forcedTerminations = 0;

  constructor(config: Partial<WorkerPoolConfig> = {}, securityLevel: SecurityLevel = 'STANDARD') {
    this.securityLevel = securityLevel;
    this.config = buildWorkerPoolConfig(securityLevel, config);
    this.executionQueue = new ExecutionQueue({
      maxQueueSize: this.config.maxQueueSize,
      queueTimeoutMs: this.config.queueTimeoutMs,
    });
    this.memoryMonitor = new MemoryMonitor(
      {
        memoryLimitPerWorker: this.config.memoryLimitPerWorker,
        memoryCheckIntervalMs: this.config.memoryCheckIntervalMs,
      },
      this.slots,
    );
    this.rateLimiter = createRateLimiter(this.config.maxMessagesPerSecond);

    // Set up memory monitor events
    this.memoryMonitor.on('memoryExceeded', this.handleMemoryExceeded.bind(this));
  }

  /**
   * Initialize the worker pool
   * Must be called before execute()
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.config.warmOnInit) {
      // Spawn minimum workers
      const spawnPromises: Promise<WorkerSlot>[] = [];
      for (let i = 0; i < this.config.minWorkers; i++) {
        spawnPromises.push(this.createAndAddSlot());
      }
      try {
        await Promise.all(spawnPromises);
      } catch (error) {
        // Clean up any workers that were created before the failure
        await Promise.all(
          Array.from(this.slots.values()).map((slot) =>
            slot.terminate(false).catch(() => {
              /* empty */
            }),
          ),
        );
        this.slots.clear();
        throw error;
      }
    }

    // Start memory monitoring
    this.memoryMonitor.start();

    this.initialized = true;
  }

  /**
   * Execute code in a worker
   */
  async execute<T = unknown>(code: string, context: ExecutionContext): Promise<ExecutionResult<T>> {
    if (this.disposed) {
      throw new WorkerPoolDisposedError();
    }

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    this._totalExecutions++;

    // Acquire a worker slot
    const slot = await this.acquireSlot(context.abortController?.signal);

    try {
      const result = await this.executeInSlot<T>(slot, code, context);
      this._successfulExecutions++;
      return result;
    } catch (error) {
      this._failedExecutions++;
      if (error instanceof WorkerTimeoutError) {
        this._timeoutExecutions++;
      }
      throw error;
    } finally {
      this.releaseSlot(slot);
    }
  }

  /**
   * Dispose the adapter and all workers
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.memoryMonitor.stop();
    this.executionQueue.clear();

    // Terminate all workers
    const terminatePromises: Promise<void>[] = [];
    for (const slot of this.slots.values()) {
      terminatePromises.push(slot.terminate(false));
    }

    // Don't await - just trigger termination and log any failures
    Promise.allSettled(terminatePromises).then((results) => {
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        console.error(`${failures.length} worker(s) failed to terminate during disposal`);
      }
    });

    this.slots.clear();
    this.rateLimiter.clear();
  }

  // ============================================================================
  // Pool Management
  // ============================================================================

  private async createAndAddSlot(): Promise<WorkerSlot> {
    const slotId = `worker-${Date.now()}-${crypto.randomUUID()}`;
    const slot = new WorkerSlot(slotId, {
      memoryLimitMB: Math.round(this.config.memoryLimitPerWorker / 1024 / 1024),
    });

    // Set up slot event handlers
    slot.on('stateChange', (newState, oldState) => {
      if (newState === 'recycling') {
        this.handleSlotRecycling(slot);
      }
    });

    await slot.spawn();
    this.slots.set(slotId, slot);
    return slot;
  }

  private async acquireSlot(signal?: AbortSignal, retryCount = 0): Promise<WorkerSlot> {
    // Guard against infinite recursion in rapid slot recycling scenarios
    const MAX_ACQUIRE_RETRIES = 3;
    if (retryCount >= MAX_ACQUIRE_RETRIES) {
      throw new QueueFullError(this.executionQueue.getStats().length, this.config.maxQueueSize);
    }

    // Try to find an idle slot
    for (const slot of this.slots.values()) {
      if (slot.isIdle) {
        slot.acquire(`exec-${Date.now()}`);
        return slot;
      }
    }

    // Try to create a new slot if under limit
    if (this.slots.size < this.config.maxWorkers) {
      const slot = await this.createAndAddSlot();
      slot.acquire(`exec-${Date.now()}`);
      return slot;
    }

    // Queue the request
    const slotId = await this.executionQueue.enqueue(signal);

    // Double check slot is still available
    const slot = this.slots.get(slotId);
    if (!slot || !slot.isIdle) {
      // Slot was removed/recycled, try again with incremented retry count
      return this.acquireSlot(signal, retryCount + 1);
    }

    slot.acquire(`exec-${Date.now()}`);
    return slot;
  }

  private releaseSlot(slot: WorkerSlot): void {
    // Don't operate on terminated/recycling slots
    if (slot.status === 'terminated' || slot.status === 'recycling' || slot.status === 'terminating') {
      return;
    }

    // Check if slot needs recycling
    if (slot.executionCount >= this.config.maxExecutionsPerWorker) {
      slot.markForRecycle('max-executions');
      return;
    }

    // Release the slot
    slot.release();

    // Notify queue that slot is available
    if (!this.executionQueue.notifySlotAvailable(slot.id)) {
      // No queued requests, slot stays idle
      this.checkIdleSlots();
    }
  }

  private async handleSlotRecycling(slot: WorkerSlot): Promise<void> {
    this._workerRecycles++;
    const slotId = slot.id;

    // Terminate the old worker
    await slot.terminate(true);
    this.slots.delete(slotId);
    this.rateLimiter.reset(slotId);

    // Create a replacement if needed
    if (this.slots.size < this.config.minWorkers && !this.disposed) {
      try {
        await this.createAndAddSlot();
      } catch (error) {
        console.error('Failed to create replacement worker:', error);
      }
    }
  }

  private handleMemoryExceeded(slotId: string, usage: ResourceUsage, limit: number): void {
    const slot = this.slots.get(slotId);
    if (!slot) return;

    // If slot is executing, we need to force terminate
    if (slot.isExecuting) {
      this._forcedTerminations++;
      slot
        .terminate(false)
        .then(() => {
          this.slots.delete(slotId);
          this.rateLimiter.reset(slotId);
          // Notify queue that a slot may be available for replacement
          this.executionQueue.notifySlotAvailable(slotId);
        })
        .catch((error) => {
          console.error('Failed to terminate memory-exceeded worker:', error);
          this.slots.delete(slotId);
          this.rateLimiter.reset(slotId);
          // Still notify queue even on error
          this.executionQueue.notifySlotAvailable(slotId);
        });
    }
  }

  private checkIdleSlots(): void {
    // Remove excess idle workers
    const now = Date.now();
    const idleSlots: WorkerSlot[] = [];

    for (const slot of this.slots.values()) {
      if (slot.isIdle) {
        idleSlots.push(slot);
      }
    }

    // Keep at least minWorkers
    const excessCount = idleSlots.length - this.config.minWorkers;
    if (excessCount <= 0) return;

    // Sort by last active time (oldest first)
    idleSlots.sort((a, b) => a.lastActiveAt - b.lastActiveAt);

    // Remove oldest excess workers that have been idle too long
    for (let i = 0; i < excessCount; i++) {
      const slot = idleSlots[i];
      if (now - slot.lastActiveAt > this.config.idleTimeoutMs) {
        slot.terminate(true).catch((error) => {
          console.error(`Failed to terminate idle worker ${slot.id}:`, error);
        });
        this.slots.delete(slot.id);
      }
    }
  }

  // ============================================================================
  // Execution
  // ============================================================================

  private async executeInSlot<T>(
    slot: WorkerSlot,
    code: string,
    context: ExecutionContext,
  ): Promise<ExecutionResult<T>> {
    const requestId = `exec-${Date.now()}-${crypto.randomUUID()}`;
    const startTime = Date.now();

    // Serialize config
    const serializedConfig: SerializedConfig = {
      timeout: context.config.timeout,
      maxIterations: context.config.maxIterations,
      maxToolCalls: context.config.maxToolCalls,
      maxConsoleOutputBytes: context.config.maxConsoleOutputBytes,
      maxConsoleCalls: context.config.maxConsoleCalls,
      sanitizeStackTraces: context.config.sanitizeStackTraces,
      maxSanitizeDepth: context.config.maxSanitizeDepth,
      maxSanitizeProperties: context.config.maxSanitizeProperties,
      globals: context.config.globals,
    };

    return new Promise<ExecutionResult<T>>((resolve, reject) => {
      // Pending tool calls for this execution
      const pendingToolCalls = new Map<string, boolean>();

      // Declare watchdogId before cleanup to avoid TDZ confusion
      let watchdogId: ReturnType<typeof setTimeout>;

      // Cleanup function to remove handlers
      const cleanup = () => {
        clearTimeout(watchdogId);
        slot.off('message', messageHandler);
        slot.off('error', errorHandler);
      };

      // Message handler
      const messageHandler: (msg: WorkerToMainMessage) => Promise<void> = async (msg: WorkerToMainMessage) => {
        try {
          // Rate limiting
          this.rateLimiter.checkLimit(slot.id);

          if (isToolCallMessage(msg) && msg.requestId === requestId) {
            await this.handleToolCall(slot, msg, context, pendingToolCalls);
          } else if (isExecutionResultMessage(msg) && msg.requestId === requestId) {
            // Execution complete
            cleanup();
            const duration = Date.now() - startTime;
            const result = this.buildResult<T>(msg, duration);
            resolve(result);
          } else if (isConsoleMessage(msg) && msg.requestId === requestId) {
            // Forward console output
            this.handleConsoleMessage(msg);
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      // Handle slot error
      const errorHandler: (error: Error) => void = (error: Error) => {
        cleanup();
        reject(error);
      };

      // Set up watchdog timeout (VM timeout + buffer)
      const watchdogTimeout = context.config.timeout + 5000;
      watchdogId = setTimeout(() => {
        this._timeoutExecutions++;
        this._forcedTerminations++;
        cleanup();
        slot.terminate(false).catch((error) => {
          console.error('Watchdog termination failed:', error);
        });
        reject(new WorkerTimeoutError());
      }, watchdogTimeout);

      slot.on('message', messageHandler);
      slot.once('error', errorHandler);

      // Send execute message
      slot.sendMessage({
        type: 'execute',
        requestId,
        code,
        config: serializedConfig,
      });
    });
  }

  private async handleToolCall(
    slot: WorkerSlot,
    msg: ToolCallMessage,
    context: ExecutionContext,
    pendingToolCalls: Map<string, boolean>,
  ): Promise<void> {
    // Check pending tool call limit
    if (pendingToolCalls.size >= this.config.maxPendingToolCalls) {
      throw new TooManyPendingCallsError(pendingToolCalls.size, this.config.maxPendingToolCalls);
    }

    pendingToolCalls.set(msg.callId, true);

    let result: unknown;
    let error: SerializedError | undefined;

    try {
      if (!context.toolHandler) {
        throw new Error('No tool handler configured');
      }

      // Sanitize args before passing to handler
      const sanitizedArgs = sanitizeObject(msg.args) as Record<string, unknown>;
      result = await context.toolHandler(msg.toolName, sanitizedArgs);
    } catch (e) {
      const err = e as Error;
      error = {
        name: err.name || 'Error',
        message: err.message || 'Unknown error',
      };
    } finally {
      pendingToolCalls.delete(msg.callId);
    }

    // Send response
    slot.sendMessage({
      type: 'tool-response',
      requestId: msg.requestId,
      callId: msg.callId,
      result: sanitizeObject(result),
      error,
    });
  }

  private handleConsoleMessage(msg: { level: string; args: unknown[] }): void {
    // Forward to console
    const level = msg.level as 'log' | 'warn' | 'error' | 'info';
    if (console[level]) {
      console[level]('[Worker]', ...msg.args);
    }
  }

  /**
   * Build result from worker message.
   *
   * Note: The `msg.value as T` assertion is inherent to cross-thread
   * serialization boundaries. The worker sanitizes output via sanitizeObject()
   * before sending, but full runtime type validation would require schema
   * definitions which are not available at this layer.
   */
  private buildResult<T>(msg: ExecutionResultMessage, duration: number): ExecutionResult<T> {
    if (msg.success) {
      return {
        success: true,
        value: msg.value as T,
        stats: {
          duration,
          toolCallCount: msg.stats.toolCallCount,
          iterationCount: msg.stats.iterationCount,
          startTime: msg.stats.startTime,
          endTime: msg.stats.endTime,
        },
      };
    } else {
      const error = msg.error ?? { name: 'Error', message: 'Unknown error' };
      return {
        success: false,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
        stats: {
          duration,
          toolCallCount: msg.stats.toolCallCount,
          iterationCount: msg.stats.iterationCount,
          startTime: msg.stats.startTime,
          endTime: msg.stats.endTime,
        },
      };
    }
  }

  // ============================================================================
  // Metrics
  // ============================================================================

  /**
   * Get pool metrics
   */
  getMetrics(): WorkerPoolMetrics {
    let idleSlots = 0;
    let executingSlots = 0;
    let recyclingSlots = 0;

    for (const slot of this.slots.values()) {
      if (slot.isIdle) idleSlots++;
      else if (slot.isExecuting) executingSlots++;
      else if (slot.status === 'recycling') recyclingSlots++;
    }

    const memoryStats = this.memoryMonitor.getCurrentUsageSummary();
    const queueStats = this.executionQueue.getStats();

    return {
      timestamp: Date.now(),
      totalSlots: this.slots.size,
      idleSlots,
      executingSlots,
      recyclingSlots,
      queuedRequests: queueStats.length,
      totalExecutions: this._totalExecutions,
      successfulExecutions: this._successfulExecutions,
      failedExecutions: this._failedExecutions,
      timeoutExecutions: this._timeoutExecutions,
      memoryKills: this.memoryMonitor.getStats().memoryExceededCount,
      forcedTerminations: this._forcedTerminations,
      workerRecycles: this._workerRecycles,
      avgExecutionTimeMs: 0, // Would need additional tracking
      avgWorkerMemory: memoryStats.avgRss,
      maxWorkerMemory: memoryStats.maxRss,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<WorkerPoolConfig> {
    return { ...this.config };
  }

  /**
   * Check if adapter is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if adapter is disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }
}
