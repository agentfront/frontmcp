/**
 * Worker Pool Error Classes
 *
 * Specialized errors for worker pool operations.
 *
 * @packageDocumentation
 */

/**
 * Base class for worker pool errors
 */
export class WorkerPoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerPoolError';
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Worker execution timed out and was terminated
 */
export class WorkerTimeoutError extends WorkerPoolError {
  constructor(message = 'Worker execution timeout - worker terminated') {
    super(message);
    this.name = 'WorkerTimeoutError';
  }
}

/**
 * Worker exceeded memory limits and was terminated
 */
export class WorkerMemoryError extends WorkerPoolError {
  /** Memory usage that triggered the error */
  readonly memoryBytes: number;
  /** Configured limit */
  readonly limitBytes: number;

  constructor(memoryBytes: number, limitBytes: number) {
    super(
      `Worker exceeded memory limit: ${Math.round(memoryBytes / 1024 / 1024)}MB > ${Math.round(
        limitBytes / 1024 / 1024,
      )}MB`,
    );
    this.name = 'WorkerMemoryError';
    this.memoryBytes = memoryBytes;
    this.limitBytes = limitBytes;
  }
}

/**
 * Worker crashed or was terminated unexpectedly
 */
export class WorkerCrashedError extends WorkerPoolError {
  /** Exit code if available */
  readonly exitCode?: number;

  constructor(message: string, exitCode?: number) {
    super(message);
    this.name = 'WorkerCrashedError';
    this.exitCode = exitCode;
  }
}

/**
 * Worker pool is disposed and cannot accept new executions
 */
export class WorkerPoolDisposedError extends WorkerPoolError {
  constructor() {
    super('Worker pool has been disposed');
    this.name = 'WorkerPoolDisposedError';
  }
}

/**
 * Execution queue is full
 */
export class QueueFullError extends WorkerPoolError {
  /** Current queue size */
  readonly queueSize: number;
  /** Maximum queue size */
  readonly maxSize: number;

  constructor(queueSize: number, maxSize: number) {
    super(`Execution queue is full: ${queueSize}/${maxSize} requests waiting`);
    this.name = 'QueueFullError';
    this.queueSize = queueSize;
    this.maxSize = maxSize;
  }
}

/**
 * Queue wait timed out
 */
export class QueueTimeoutError extends WorkerPoolError {
  /** Time waited in milliseconds */
  readonly waitedMs: number;

  constructor(waitedMs: number) {
    super(`Queue timeout after ${waitedMs}ms`);
    this.name = 'QueueTimeoutError';
    this.waitedMs = waitedMs;
  }
}

/**
 * Execution was aborted
 */
export class ExecutionAbortedError extends WorkerPoolError {
  constructor(reason = 'Execution aborted') {
    super(reason);
    this.name = 'ExecutionAbortedError';
  }
}

/**
 * Message rate limit exceeded
 */
export class MessageFloodError extends WorkerPoolError {
  /** Worker slot ID */
  readonly slotId: string;

  constructor(slotId: string) {
    super('Message rate limit exceeded');
    this.name = 'MessageFloodError';
    this.slotId = slotId;
  }
}

/**
 * Message validation failed
 */
export class MessageValidationError extends WorkerPoolError {
  constructor(details?: string) {
    super(details ? `Invalid message: ${details}` : 'Invalid message format');
    this.name = 'MessageValidationError';
  }
}

/**
 * Message size exceeded limit
 */
export class MessageSizeError extends WorkerPoolError {
  /** Actual message size */
  readonly sizeBytes: number;
  /** Maximum allowed size */
  readonly maxBytes: number;

  constructor(sizeBytes: number, maxBytes: number) {
    super(`Message size ${Math.round(sizeBytes / 1024)}KB exceeds limit ${Math.round(maxBytes / 1024)}KB`);
    this.name = 'MessageSizeError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

/**
 * Worker failed to start
 */
export class WorkerStartupError extends WorkerPoolError {
  /** Original error that caused startup failure */
  override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'WorkerStartupError';
    this.cause = cause;
  }
}

/**
 * Too many pending tool calls
 */
export class TooManyPendingCallsError extends WorkerPoolError {
  /** Current pending count */
  readonly pending: number;
  /** Maximum allowed */
  readonly max: number;

  constructor(pending: number, max: number) {
    super(`Too many pending tool calls: ${pending}/${max}`);
    this.name = 'TooManyPendingCallsError';
    this.pending = pending;
    this.max = max;
  }
}
