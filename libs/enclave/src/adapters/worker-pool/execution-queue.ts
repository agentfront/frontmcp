/**
 * Execution Queue
 *
 * Handles backpressure when the worker pool is exhausted.
 * Queues execution requests and dispatches them when workers become available.
 *
 * @packageDocumentation
 */

import { QueueFullError, QueueTimeoutError, ExecutionAbortedError } from './errors';
import type { WorkerPoolConfig } from './config';

/**
 * Queued execution request
 */
interface QueuedExecution {
  /** Unique identifier */
  id: string;
  /** Resolve function to call when a worker is available */
  resolve: (slotId: string) => void;
  /** Reject function to call on error/timeout */
  reject: (error: Error) => void;
  /** Timestamp when queued */
  enqueuedAt: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Timeout timer ID */
  timeoutId?: ReturnType<typeof setTimeout>;
  /** Abort listener cleanup function */
  abortCleanup?: () => void;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Current queue length */
  length: number;
  /** Maximum queue size */
  maxSize: number;
  /** Total requests ever queued */
  totalQueued: number;
  /** Total requests fulfilled */
  totalFulfilled: number;
  /** Total requests timed out */
  totalTimedOut: number;
  /** Total requests aborted */
  totalAborted: number;
  /** Longest wait time in milliseconds */
  longestWaitMs: number;
  /** Average wait time in milliseconds */
  avgWaitMs: number;
}

/**
 * Execution queue with configurable limits and timeout handling
 */
export class ExecutionQueue {
  private readonly queue: QueuedExecution[] = [];
  private readonly config: Pick<WorkerPoolConfig, 'maxQueueSize' | 'queueTimeoutMs'>;

  // Statistics
  private _totalQueued = 0;
  private _totalFulfilled = 0;
  private _totalTimedOut = 0;
  private _totalAborted = 0;
  private _longestWaitMs = 0;
  private _totalWaitMs = 0;

  constructor(config: Pick<WorkerPoolConfig, 'maxQueueSize' | 'queueTimeoutMs'>) {
    this.config = config;
  }

  /**
   * Get current queue length
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is full
   */
  get isFull(): boolean {
    return this.queue.length >= this.config.maxQueueSize;
  }

  /**
   * Enqueue an execution request
   *
   * @param signal Optional abort signal
   * @returns Promise that resolves with a slot ID when a worker is available
   * @throws QueueFullError if queue is at capacity
   * @throws QueueTimeoutError if queue wait times out
   * @throws ExecutionAbortedError if aborted via signal
   */
  async enqueue(signal?: AbortSignal): Promise<string> {
    // Check queue capacity
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new QueueFullError(this.queue.length, this.config.maxQueueSize);
    }

    // Check if already aborted
    if (signal?.aborted) {
      throw new ExecutionAbortedError('Execution aborted before queuing');
    }

    const id = `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._totalQueued++;

    return new Promise<string>((resolve, reject) => {
      const execution: QueuedExecution = {
        id,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        signal,
      };

      // Set up timeout
      execution.timeoutId = setTimeout(() => {
        this.removeFromQueue(id);
        this._totalTimedOut++;
        reject(new QueueTimeoutError(Date.now() - execution.enqueuedAt));
      }, this.config.queueTimeoutMs);

      // Set up abort handling
      if (signal) {
        const abortHandler = () => {
          this.removeFromQueue(id);
          clearTimeout(execution.timeoutId);
          this._totalAborted++;
          reject(new ExecutionAbortedError('Execution aborted while queued'));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
        execution.abortCleanup = () => {
          signal.removeEventListener('abort', abortHandler);
        };
      }

      this.queue.push(execution);
    });
  }

  /**
   * Notify the queue that a worker slot is available
   *
   * @param slotId ID of the available slot
   * @returns true if a queued request was fulfilled, false if queue was empty
   */
  notifySlotAvailable(slotId: string): boolean {
    if (this.queue.length === 0) {
      return false;
    }

    const execution = this.queue.shift()!;

    // Clean up timeout and abort listener
    if (execution.timeoutId) {
      clearTimeout(execution.timeoutId);
    }
    if (execution.abortCleanup) {
      execution.abortCleanup();
    }

    // Track statistics
    const waitTime = Date.now() - execution.enqueuedAt;
    this._totalWaitMs += waitTime;
    this._totalFulfilled++;
    if (waitTime > this._longestWaitMs) {
      this._longestWaitMs = waitTime;
    }

    // Fulfill the request
    execution.resolve(slotId);
    return true;
  }

  /**
   * Remove a specific request from the queue
   */
  private removeFromQueue(id: string): void {
    const index = this.queue.findIndex((e) => e.id === id);
    if (index !== -1) {
      const [execution] = this.queue.splice(index, 1);

      // Clean up
      if (execution.timeoutId) {
        clearTimeout(execution.timeoutId);
      }
      if (execution.abortCleanup) {
        execution.abortCleanup();
      }
    }
  }

  /**
   * Clear the queue, rejecting all pending requests
   */
  clear(): void {
    for (const execution of this.queue) {
      if (execution.timeoutId) {
        clearTimeout(execution.timeoutId);
      }
      if (execution.abortCleanup) {
        execution.abortCleanup();
      }
      execution.reject(new ExecutionAbortedError('Queue cleared'));
    }
    this.queue.length = 0;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      length: this.queue.length,
      maxSize: this.config.maxQueueSize,
      totalQueued: this._totalQueued,
      totalFulfilled: this._totalFulfilled,
      totalTimedOut: this._totalTimedOut,
      totalAborted: this._totalAborted,
      longestWaitMs: this._longestWaitMs,
      avgWaitMs: this._totalFulfilled > 0 ? this._totalWaitMs / this._totalFulfilled : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this._totalQueued = 0;
    this._totalFulfilled = 0;
    this._totalTimedOut = 0;
    this._totalAborted = 0;
    this._longestWaitMs = 0;
    this._totalWaitMs = 0;
  }
}
