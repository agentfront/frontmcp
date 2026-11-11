import type { FrontMcpLogger, ResolvedWorkerRestart, WorkerRunContext } from '../common';
import { describeThrown } from '../duty/describe-thrown';

export type WorkerLogger = Pick<FrontMcpLogger, 'info' | 'warn' | 'error'>;

/**
 * What a worker does in this process: `'running'` its `run()`, `'restarting'` (waiting to run it again), `'stopped'`
 * (it ended and `restart: false` keeps it so), or `'standby'` (not running here: the server has not started it yet,
 * shut it down, or another process holds its lease).
 */
export type WorkerState = 'running' | 'restarting' | 'stopped' | 'standby';

export interface WorkerStatus {
  state: WorkerState;
  /** How many times `run()` was started again after it returned or threw. */
  restarts: number;
  /** The message of the last error `run()` threw, until a run returns. */
  lastError?: string;
}

export interface WorkerSupervisorOptions {
  name: string;
  restart: false | ResolvedWorkerRestart;
  logger: WorkerLogger;
  run(context: WorkerRunContext): unknown;
}

/**
 * Keeps a worker's `run()` going. When it returns or throws while its signal is not aborted, it runs again after a
 * wait that starts at `minDelayMs`, grows by `factor` up to `maxDelayMs`, and starts over after a run that lasted
 * longer than `maxDelayMs`. A failure is logged and never thrown.
 */
export class WorkerSupervisor {
  private controller?: AbortController;
  private ended: Promise<void> = Promise.resolve();
  private state: WorkerState = 'standby';
  private restarts = 0;
  private lastError?: string;
  private stopped = false;
  private finished = false;

  /** Takes the worker's name, its restart policy, the logger and the `run()` to keep going. */
  constructor(private readonly options: WorkerSupervisorOptions) {}

  /**
   * Start the runs; a run still ending after the last `abort()` ends first, so two never overlap. Nothing starts
   * once `stop()` was called.
   */
  start(): void {
    if (this.stopped) return;
    const controller = new AbortController();
    this.controller = controller;
    this.ended = this.ended
      .then(() => this.supervise(controller.signal))
      .catch((error: unknown) =>
        this.options.logger.error(`Worker "${this.options.name}" is no longer supervised: ${describeThrown(error)}`),
      );
  }

  /** Abort the run in flight, and the wait before the next one; a worker that stopped for good is on standby here. */
  abort(): void {
    this.controller?.abort();
    if (this.state === 'stopped') this.state = 'standby';
  }

  /** Abort for good, and resolve once the run in flight has ended. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort();
    await this.ended;
  }

  /** The worker's state, its restart count and the last error it threw, if any. */
  status(): WorkerStatus {
    const { state, restarts, lastError } = this;
    return lastError === undefined ? { state, restarts } : { state, restarts, lastError };
  }

  /**
   * Rerun the worker with a growing wait between runs, until `signal` aborts or restarts are off. A `restart: false`
   * worker whose run ended never runs again, even when started again.
   */
  private async supervise(signal: AbortSignal): Promise<void> {
    if (this.finished) {
      if (!signal.aborted) this.state = 'stopped';
      return;
    }
    const { restart } = this.options;
    let delayMs = restart ? restart.minDelayMs : 0;
    while (!signal.aborted) {
      this.state = 'running';
      const startedAt = performance.now();
      const failure = await this.runOnce(signal);
      if (signal.aborted) break;
      if (!restart) {
        this.finished = true;
        this.state = 'stopped';
        this.report(failure, 'it does not run again (restart: false)');
        return;
      }
      if (performance.now() - startedAt > restart.maxDelayMs) delayMs = restart.minDelayMs;
      this.state = 'restarting';
      this.restarts++;
      this.report(failure, `it runs again in ${delayMs} ms`);
      await aborted(signal, delayMs);
      delayMs = Math.min(delayMs * restart.factor, restart.maxDelayMs);
    }
    this.state = 'standby';
  }

  /**
   * Run once; the message of what it threw while its signal was not aborted, kept for the health check until a run
   * returns.
   */
  private async runOnce(signal: AbortSignal): Promise<string | undefined> {
    try {
      await this.options.run({ signal });
      this.lastError = undefined;
      return undefined;
    } catch (error) {
      if (signal.aborted) return undefined;
      this.lastError = describeThrown(error);
      return this.lastError;
    }
  }

  /** Log how a run ended, a failure as an error and a plain return as a warning, and what happens next. */
  private report(failure: string | undefined, next: string): void {
    const { name, logger } = this.options;
    if (failure === undefined) logger.warn(`Worker "${name}" returned before its signal was aborted; ${next}`);
    else logger.error(`Worker "${name}" failed: ${failure}; ${next}`);
  }
}

/** Resolve when `signal` aborts, or after `timeoutMs`. */
function aborted(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', settle);
      resolve();
    };
    const timer = setTimeout(settle, timeoutMs);
    timer.unref?.();
    signal.addEventListener('abort', settle);
  });
}
