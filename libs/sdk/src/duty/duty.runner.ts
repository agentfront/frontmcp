import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import type { DutyRunContext, FrontMcpLogger } from '../common';

/** The store operations a lease needs; the SQLite, Redis and memory stores run each one atomically. */
export type DutyLeaseStorage = Pick<NamespacedStorage, 'set' | 'get' | 'ttl' | 'expireIfEquals' | 'deleteIfEquals'>;

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
  private readonly holder = randomUUID();
  private readonly leaseSeconds: number;
  private readonly ranKey: string;
  private holding = false;
  private stopped = false;
  private leaseCheck?: Promise<void>;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private inFlight?: RunInFlight;

  constructor(private readonly options: DutyRunnerOptions) {
    this.leaseSeconds = Math.ceil(options.leaseMs / 1_000);
    this.ranKey = `${options.key}:ran`;
  }

  /** Contend for the lease once now, then renew or contend again every third of the lease. */
  async start(): Promise<void> {
    this.leaseCheck = this.checkLease();
    await this.leaseCheck;
  }

  /** Stop contending, abort the run in flight and wait for it, then release the lease. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.leaseTimer);
    clearTimeout(this.tickTimer);
    await this.leaseCheck;
    this.inFlight?.controller.abort();
    await this.inFlight?.done;
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
        if (!(await this.renew())) this.lose();
      } else if (await this.acquire()) {
        await this.hold();
      }
    } catch (error) {
      this.options.logger.warn(`Duty "${this.options.name}": the lease store failed: ${messageOf(error)}`);
    }
    if (this.stopped) return;
    this.leaseTimer = setTimeout(() => {
      this.leaseCheck = this.checkLease();
    }, this.options.leaseMs / 3);
    this.leaseTimer.unref?.();
  }

  private async acquire(): Promise<boolean> {
    const { storage, key } = this.options;
    await storage.set(key, this.holder, { ttlSeconds: this.leaseSeconds, ifNotExists: true });
    this.holding = (await storage.get(key)) === this.holder;
    return this.holding;
  }

  private renew(): Promise<boolean> {
    return this.options.storage.expireIfEquals(this.options.key, this.holder, this.leaseSeconds);
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
    this.scheduleTick(Math.max(0, remainingSeconds ?? 0) * 1_000);
  }

  private lose(): void {
    if (!this.holding) return;
    this.holding = false;
    clearTimeout(this.tickTimer);
    this.inFlight?.controller.abort();
    this.options.logger.warn(`Duty "${this.options.name}" lost its lease; another process runs it now`);
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
        this.lose();
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
