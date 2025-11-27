/**
 * Worker Slot
 *
 * Manages a single worker thread with state tracking, lifecycle management,
 * and metrics collection.
 *
 * @packageDocumentation
 */

import { Worker } from 'worker_threads';
import path from 'path';
import { EventEmitter } from 'events';
import type { WorkerSlotStatus, ResourceUsage, WorkerPoolConfig } from './config';
import type { MainToWorkerMessage, WorkerToMainMessage, SerializedConfig, WorkerExecutionStats } from './protocol';
import { safeDeserialize, safeSerialize } from './safe-deserialize';
import { WorkerStartupError, WorkerCrashedError } from './errors';

/**
 * Events emitted by WorkerSlot
 */
export interface WorkerSlotEvents {
  /** Worker sent a message */
  message: [WorkerToMainMessage];
  /** Worker exited */
  exit: [number | null];
  /** Worker errored */
  error: [Error];
  /** Worker is ready */
  ready: [];
  /** State changed */
  stateChange: [WorkerSlotStatus, WorkerSlotStatus];
}

/**
 * Worker slot options
 */
export interface WorkerSlotOptions {
  /** Memory limit in MB for --max-old-space-size */
  memoryLimitMB: number;
  /** Startup timeout in milliseconds */
  startupTimeoutMs?: number;
}

/**
 * Manages a single worker thread
 */
export class WorkerSlot extends EventEmitter {
  /** Unique slot identifier */
  readonly id: string;

  /** The underlying worker thread */
  private _worker: Worker | null = null;

  /** Current status */
  private _status: WorkerSlotStatus = 'created';

  /** Number of executions completed */
  private _executionCount = 0;

  /** Creation timestamp */
  readonly createdAt: number;

  /** Last activity timestamp */
  private _lastActiveAt: number;

  /** Current execution request ID (if executing) */
  private _currentExecutionId: string | null = null;

  /** Last memory report */
  private _memoryUsage: ResourceUsage | null = null;

  /** Configuration */
  private readonly options: Required<WorkerSlotOptions>;

  /** Message handler bound to this instance */
  private readonly boundMessageHandler: (raw: string) => void;

  /** Error handler bound to this instance */
  private readonly boundErrorHandler: (error: Error) => void;

  /** Exit handler bound to this instance */
  private readonly boundExitHandler: (code: number | null) => void;

  constructor(id: string, options: WorkerSlotOptions) {
    super();
    this.id = id;
    this.createdAt = Date.now();
    this._lastActiveAt = this.createdAt;
    this.options = {
      memoryLimitMB: options.memoryLimitMB,
      startupTimeoutMs: options.startupTimeoutMs ?? 10000,
    };

    this.boundMessageHandler = this.handleMessage.bind(this);
    this.boundErrorHandler = this.handleError.bind(this);
    this.boundExitHandler = this.handleExit.bind(this);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  get worker(): Worker | null {
    return this._worker;
  }

  get status(): WorkerSlotStatus {
    return this._status;
  }

  get executionCount(): number {
    return this._executionCount;
  }

  get lastActiveAt(): number {
    return this._lastActiveAt;
  }

  get currentExecutionId(): string | null {
    return this._currentExecutionId;
  }

  get memoryUsage(): ResourceUsage | null {
    return this._memoryUsage;
  }

  get isIdle(): boolean {
    return this._status === 'idle';
  }

  get isExecuting(): boolean {
    return this._status === 'executing';
  }

  get isTerminated(): boolean {
    return this._status === 'terminated' || this._status === 'terminating';
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Spawn the worker thread
   */
  async spawn(): Promise<void> {
    if (this._worker) {
      throw new Error(`Worker slot ${this.id} already has a worker`);
    }

    const workerScriptPath = this.getWorkerScriptPath();

    this._worker = new Worker(workerScriptPath, {
      execArgv: [`--max-old-space-size=${this.options.memoryLimitMB}`],
    });

    // Set up event handlers
    this._worker.on('message', this.boundMessageHandler);
    this._worker.on('error', this.boundErrorHandler);
    this._worker.on('exit', this.boundExitHandler);

    // Wait for ready message
    await this.waitForReady();

    this.setStatus('idle');
  }

  /**
   * Get the path to the worker script
   */
  private getWorkerScriptPath(): string {
    // Use __dirname for CommonJS compatibility
    // The worker-script.js will be in the same directory after compilation
    return path.join(__dirname, 'worker-script.js');
  }

  /**
   * Wait for the worker to send ready message
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timeout);
        resolve();
      };

      const timeout = setTimeout(() => {
        this.off('ready', onReady); // Remove listener on timeout to prevent memory leak
        reject(new WorkerStartupError(`Worker ${this.id} startup timeout`));
      }, this.options.startupTimeoutMs);

      this.once('ready', onReady);
    });
  }

  /**
   * Acquire this slot for execution
   */
  acquire(executionId: string): void {
    if (this._status !== 'idle') {
      throw new Error(`Cannot acquire worker slot ${this.id} in state ${this._status}`);
    }

    this._currentExecutionId = executionId;
    this._lastActiveAt = Date.now();
    this.setStatus('executing');
  }

  /**
   * Release this slot after execution
   */
  release(): void {
    if (this._status !== 'executing') {
      return;
    }

    this._currentExecutionId = null;
    this._executionCount++;
    this._lastActiveAt = Date.now();
    this.setStatus('idle');
  }

  /**
   * Mark this slot for recycling
   */
  markForRecycle(reason: string): void {
    if (this._status === 'terminated' || this._status === 'terminating') {
      return;
    }

    this.setStatus('recycling');
  }

  /**
   * Terminate the worker
   */
  async terminate(graceful = true): Promise<void> {
    if (!this._worker || this._status === 'terminated') {
      return;
    }

    this.setStatus('terminating');
    const worker = this._worker; // Capture reference to avoid race condition

    if (graceful) {
      // Send terminate message and wait
      this.sendMessage({ type: 'terminate', graceful: true });

      // Wait for graceful exit (with timeout)
      await Promise.race([
        new Promise<void>((resolve) => {
          if (worker) {
            worker.once('exit', () => resolve());
          } else {
            resolve();
          }
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }

    // Force terminate if still running
    if (this._worker) {
      try {
        await this._worker.terminate();
      } catch {
        // Worker already exited
      }
    }

    this.cleanup();
    this.setStatus('terminated');
  }

  /**
   * Send a message to the worker
   */
  sendMessage(msg: MainToWorkerMessage): void {
    if (!this._worker) {
      throw new Error(`Worker slot ${this.id} has no worker`);
    }

    this._worker.postMessage(safeSerialize(msg));
  }

  /**
   * Request memory report from worker
   */
  async requestMemoryReport(timeoutMs = 1000): Promise<ResourceUsage> {
    return new Promise((resolve, reject) => {
      const handler = (msg: WorkerToMainMessage) => {
        if (msg.type === 'memory-report-result') {
          clearTimeout(timeout);
          this.off('message', handler);
          this._memoryUsage = msg.usage;
          resolve(msg.usage);
        }
      };

      const timeout = setTimeout(() => {
        this.off('message', handler); // Remove listener on timeout to prevent memory leak
        reject(new Error('Memory report timeout'));
      }, timeoutMs);

      this.on('message', handler);
      this.sendMessage({ type: 'memory-report' });
    });
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  private handleMessage(raw: string): void {
    try {
      const msg = safeDeserialize(raw) as WorkerToMainMessage;

      if (msg.type === 'ready') {
        this.emit('ready');
      } else if (msg.type === 'memory-report-result') {
        this._memoryUsage = msg.usage;
      }

      this.emit('message', msg);
    } catch (error) {
      console.error(`Worker ${this.id} message parse error:`, error);
      this.markForRecycle('protocol-error'); // Recycle on protocol errors (defensive)
    }
  }

  private handleError(error: Error): void {
    console.error(`Worker ${this.id} error:`, error);
    this.emit('error', error);

    // Mark for recycling on error
    if (this._status !== 'terminated' && this._status !== 'terminating') {
      this.markForRecycle('error');
    }
  }

  private handleExit(code: number | null): void {
    this.emit('exit', code);

    if (this._status !== 'terminating' && this._status !== 'terminated') {
      // Unexpected exit
      this.cleanup();
      this.setStatus('terminated');
      this.emit('error', new WorkerCrashedError(`Worker ${this.id} exited unexpectedly`, code ?? undefined));
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private setStatus(newStatus: WorkerSlotStatus): void {
    const oldStatus = this._status;
    this._status = newStatus;
    this.emit('stateChange', newStatus, oldStatus);
  }

  private cleanup(): void {
    if (this._worker) {
      this._worker.off('message', this.boundMessageHandler);
      this._worker.off('error', this.boundErrorHandler);
      this._worker.off('exit', this.boundExitHandler);
      this._worker = null;
    }
    this._currentExecutionId = null;
  }
}
