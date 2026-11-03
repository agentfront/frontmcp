import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import type { DutyRunContext, FrontMcpLogger } from '../common';

/** The store operations a lease needs; the SQLite, Redis and memory stores run each one atomically. */
export type DutyLeaseStorage = Pick<NamespacedStorage, 'set' | 'ttl' | 'expireIfEquals' | 'deleteIfEquals'>;

export type DutyLogger = Pick<FrontMcpLogger, 'verbose' | 'info' | 'warn' | 'error'>;

export interface DutyRunnerOptions {
  name: string;
  key: string;
  everyMs: number;
  leaseMs: number;
  storage: DutyLeaseStorage;
  logger: DutyLogger;
  run(context: DutyRunContext): unknown;
}

interface RunInFlight {
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Runs a duty every `everyMs` while this process holds its lease, and contends for the lease otherwise. The lease is a
 * key holding this runner's id with a TTL, so it expires by the store's clock when the holder stops renewing it. The
 * holder renews it every third of `leaseMs`, and again before each run, so a holder that wakes after another process
 * took the lease over never runs again.
 */
export class DutyRunner {
  private readonly holder: string;
  private readonly leaseSeconds: number;
  private readonly ranKey: string;
  private holding = false;
  private stopped = false;
  private reportedHeldElsewhere = false;
  private leaseCheck?: Promise<void>;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private leaseDeadline?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private inFlight?: RunInFlight;

  constructor(private readonly options: DutyRunnerOptions) {
    this.holder = randomUUID();
    this.leaseSeconds = Math.ceil(options.leaseMs / 1_000);
    this.ranKey = `${options.key}:ran`;
  }

  /** Contend for the lease once now, then renew or contend again every third of the lease. */
  async start(): Promise<void> {
    this.leaseCheck = this.checkLease();
    await this.leaseCheck;
  }

  /** Stop contending, abort the run in flight and wait for it while still renewing the lease, then release it. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.tickTimer);
    this.inFlight?.controller.abort();
    await this.inFlight?.done;
    clearTimeout(this.leaseTimer);
    await this.leaseCheck;
    clearTimeout(this.leaseDeadline);
    if (!this.holding) return;
    this.holding = false;
    try {
      await this.options.storage.deleteIfEquals(this.options.key, this.holder);
    } catch (error) {
      this.options.logger.warn(`Duty "${this.options.name}": the lease store failed: ${messageOf(error)}`);
    }
  }

  private async checkLease(): Promise<void> {
    try {
      if (this.holding) {
        if (!(await this.renew())) this.lose('lost its lease; another process runs it now');
      } else if (!this.stopped) {
        if (await this.acquire()) await this.hold();
        else this.reportHeldElsewhere();
      }
    } catch (error) {
      this.options.logger.warn(`Duty "${this.options.name}": the lease store failed: ${messageOf(error)}`);
    }
    if (this.stopped && !this.inFlight) return;
    this.leaseTimer = setTimeout(() => {
      this.leaseCheck = this.checkLease();
    }, this.options.leaseMs / 3);
    this.leaseTimer.unref?.();
  }

  private async acquire(): Promise<boolean> {
    await this.options.storage.set(this.options.key, this.holder, { ttlSeconds: this.leaseSeconds, ifNotExists: true });
    this.holding = await this.renew();
    return this.holding;
  }

  /** Extend the lease while it holds this runner's id, and give up holding it by the time the store could end it. */
  private async renew(): Promise<boolean> {
    const sentAt = performance.now();
    const renewed = await this.options.storage.expireIfEquals(this.options.key, this.holder, this.leaseSeconds);
    if (renewed) this.holdUntil(sentAt + this.options.leaseMs);
    return renewed;
  }

  /**
   * Stop at `deadline` (monotonic) unless a renew succeeds first: the store ends the lease no sooner, so this process
   * never runs past the point where another one could take the lease over, even while the store can't be reached.
   */
  private holdUntil(deadline: number): void {
    clearTimeout(this.leaseDeadline);
    this.leaseDeadline = setTimeout(
      () =>
        this.lose(
          `could not renew its lease within ${this.options.leaseMs} ms; it stops here until it gets the lease again`,
        ),
      deadline - performance.now(),
    );
    this.leaseDeadline.unref?.();
  }

  private reportHeldElsewhere(): void {
    if (this.reportedHeldElsewhere) return;
    this.reportedHeldElsewhere = true;
    this.options.logger.info(
      `Duty "${this.options.name}" already runs elsewhere (lease "${this.options.key}"); this one takes it over if that one stops`,
    );
  }

  /**
   * Start the runs, the first once the interval the last run (in any process) started has passed, or a whole interval
   * from now when the store can't say when that was.
   */
  private async hold(): Promise<void> {
    this.options.logger.info(`Duty "${this.options.name}" runs in this process every ${this.options.everyMs} ms`);
    const remainingSeconds = await this.options.storage.ttl(this.ranKey).catch(() => undefined);
    if (this.stopped || !this.holding) return;
    if (remainingSeconds === undefined) return this.scheduleTick(this.options.everyMs);
    this.scheduleTick(Math.min(Math.max(0, remainingSeconds ?? 0) * 1_000, this.options.everyMs));
  }

  private lose(reason: string): void {
    if (!this.holding) return;
    this.holding = false;
    clearTimeout(this.tickTimer);
    clearTimeout(this.leaseDeadline);
    this.inFlight?.controller.abort();
    this.options.logger.warn(`Duty "${this.options.name}" ${reason}`);
  }

  private scheduleTick(delayMs: number): void {
    this.tickTimer = setTimeout(() => {
      this.scheduleTick(this.options.everyMs);
      void this.tick();
    }, delayMs);
    this.tickTimer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      this.options.logger.verbose(`Duty "${this.options.name}" is still running; skipping this run`);
      return;
    }
    const controller = new AbortController();
    const done = this.runIfHeld(controller.signal);
    this.inFlight = { controller, done };
    await done;
    this.inFlight = undefined;
  }

  private async runIfHeld(signal: AbortSignal): Promise<void> {
    if (!(await this.claimRun())) return;
    try {
      await this.options.run({ signal });
    } catch (error) {
      this.options.logger.error(`Duty "${this.options.name}" failed: ${messageOf(error)}`);
    }
  }

  /** Renew the lease right before a run, so a holder that lost it while paused never runs, and mark the run. */
  private async claimRun(): Promise<boolean> {
    try {
      if (!(await this.renew())) {
        this.lose('lost its lease; another process runs it now');
        return false;
      }
      if (this.stopped) return false;
      const intervalSeconds = Math.max(1, Math.ceil(this.options.everyMs / 1_000));
      await this.options.storage.set(this.ranKey, this.holder, { ttlSeconds: intervalSeconds });
      return true;
    } catch (error) {
      this.options.logger.warn(`Duty "${this.options.name}": the lease store failed: ${messageOf(error)}`);
      return false;
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
