import { type JobStateStore } from '../store/job-state.interface';

/** How often a runner renews its heartbeat, and how long the store keeps it without a renewal. */
export const RUNNER_HEARTBEAT_MS = 1_000;
export const RUNNER_HEARTBEAT_TTL_SECONDS = 5;

/**
 * Keeps the last value pushed and writes it every `everyMs` at most: never two writes at once, nothing
 * when nothing new came, and a failed write's value is kept for the next tick.
 */
export class LatestValueFlusher<T> {
  private pending?: { value: T };
  private inFlight?: Promise<void>;
  private readonly timer: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(
    private readonly write: (value: T) => Promise<void>,
    everyMs: number,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
  }

  push(value: T): void {
    if (!this.stopped) this.pending = { value };
  }

  /** Write what is pending now, after the write in flight. */
  async flush(): Promise<void> {
    await this.inFlight;
    await this.tick();
  }

  /** Stop the ticks; what is still pending is dropped. */
  stop(): void {
    this.stopped = true;
    this.pending = undefined;
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.inFlight || !this.pending) return;
    const { value } = this.pending;
    this.pending = undefined;
    this.inFlight = this.write(value).catch((error: unknown) => {
      this.pending ??= { value };
      this.onError(error);
    });
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }
}

/**
 * A runner's heartbeat in the job store: written before the first `hold()` resolves, renewed every second
 * while anything holds it, and left to expire by the store's TTL once nothing does.
 */
export class RunnerHeartbeat {
  private holders = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: Pick<JobStateStore, 'touchRunner'>,
    readonly runnerId: string,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** Hold the heartbeat until the returned function is called. */
  async hold(): Promise<() => void> {
    this.holders++;
    if (this.holders === 1 && this.store.touchRunner) {
      this.timer = setInterval(() => void this.beat(), RUNNER_HEARTBEAT_MS);
      this.timer.unref?.();
      await this.beat();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders--;
      if (this.holders === 0) clearInterval(this.timer);
    };
  }

  private async beat(): Promise<void> {
    try {
      await this.store.touchRunner?.(this.runnerId, RUNNER_HEARTBEAT_TTL_SECONDS);
    } catch (error) {
      this.onError(error);
    }
  }
}
