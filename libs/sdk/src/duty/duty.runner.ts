import { type NamespacedStorage } from '@frontmcp/utils';

import type { DutyRunContext, FrontMcpLogger } from '../common';
import { takeDueRun, type CronLedgerStorage, type CronSchedule } from './cron-schedule';
import { LeaseHolder } from './lease-holder';

/** The store operations a duty needs; the SQLite, Redis and memory stores run each one atomically. */
export type DutyLeaseStorage = Pick<NamespacedStorage, 'set' | 'ttl' | 'expireIfEquals' | 'deleteIfEquals'>;

export type DutyLogger = Pick<FrontMcpLogger, 'verbose' | 'info' | 'warn' | 'error'>;

interface DutyRunnerCommonOptions {
  name: string;
  /** What runs, as logs name it. @default `Duty "<name>"` */
  label?: string;
  key: string;
  leaseMs: number;
  logger: DutyLogger;
  run(context: DutyRunContext): unknown;
}

interface IntervalDutyRunnerOptions extends DutyRunnerCommonOptions {
  everyMs: number;
  cron?: undefined;
  storage: DutyLeaseStorage;
}

interface CronDutyRunnerOptions extends DutyRunnerCommonOptions {
  cron: CronSchedule;
  everyMs?: undefined;
  storage: DutyLeaseStorage & CronLedgerStorage;
}

export type DutyRunnerOptions = IntervalDutyRunnerOptions | CronDutyRunnerOptions;

const MAX_TIMER_MS = 2_147_483_647;

interface RunInFlight {
  controller: AbortController;
  done: Promise<void>;
  /** Whether the duty's `run()` started; until then the tick is only checking whether a run is due. */
  running: boolean;
  /** Whether another tick arrived during that check, so it is made again. */
  recheck: boolean;
}

/**
 * Runs a duty every `everyMs`, or at the times of `cron`, while this process holds its lease (see `LeaseHolder`). The
 * holder renews the lease again before each run, so a holder that wakes after another process took the lease over
 * never runs again.
 */
export class DutyRunner {
  private readonly label: string;
  private readonly ranKey: string;
  private readonly lease: LeaseHolder;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private inFlight?: RunInFlight;

  constructor(private readonly options: DutyRunnerOptions) {
    const { name, key, leaseMs, storage, logger } = options;
    this.label = options.label ?? `Duty "${name}"`;
    this.ranKey = `${key}:ran`;
    this.lease = new LeaseHolder({
      label: this.label,
      key,
      leaseMs,
      storage,
      logger,
      onAcquired: () => this.hold(),
      onLost: () => this.stopRunning(),
    });
  }

  /** Contend for the lease once now, then renew or contend again every third of the lease. */
  start(): Promise<void> {
    return this.lease.start();
  }

  /** Stop contending, abort the run in flight and wait for it while still renewing the lease, then release it. */
  stop(): Promise<void> {
    return this.lease.stop(async () => {
      this.stopRunning();
      await this.inFlight?.done;
    });
  }

  private stopRunning(): void {
    clearTimeout(this.tickTimer);
    this.inFlight?.controller.abort();
  }

  private async hold(): Promise<void> {
    const { cron, everyMs, logger } = this.options;
    const cadence = cron ? `on cron "${cron.expression}" (${cron.timezone})` : `every ${everyMs} ms`;
    logger.info(`${this.label} runs in this process ${cadence}`);
    const firstRunDelayMs = await this.firstRunDelayMs();
    if (this.lease.stopping || !this.lease.holding) return;
    this.scheduleTick(firstRunDelayMs);
  }

  /**
   * An interval's first run waits until the interval the last run (in any process) started has passed, or a whole
   * interval when the store can't say when that was. A cron checks at once whether a scheduled time was missed.
   */
  private async firstRunDelayMs(): Promise<number> {
    const { options } = this;
    if (options.cron) return 0;
    const remainingSeconds = await options.storage.ttl(this.ranKey).catch(() => undefined);
    if (remainingSeconds === undefined) return options.everyMs;
    return Math.min(Math.max(0, remainingSeconds ?? 0) * 1_000, options.everyMs);
  }

  private scheduleTick(delayMs: number): void {
    this.tickTimer = setTimeout(() => {
      this.scheduleTick(this.nextTickDelayMs());
      void this.tick();
    }, delayMs);
    this.tickTimer.unref?.();
  }

  /** An interval ticks every `everyMs`; a cron at its next scheduled time, in waits no longer than a timer can hold. */
  private nextTickDelayMs(): number {
    const { options } = this;
    if (!options.cron) return options.everyMs;
    const now = Date.now();
    return Math.min(options.cron.nextAfter(now) - now, MAX_TIMER_MS);
  }

  /** Start a run unless one is running; a tick that arrives during an earlier tick's check has it made again. */
  private async tick(): Promise<void> {
    if (this.inFlight?.running) {
      this.options.logger.verbose(`${this.label} is still running; skipping this run`);
      return;
    }
    if (this.inFlight) {
      this.inFlight.recheck = true;
      return;
    }
    const inFlight: RunInFlight = {
      controller: new AbortController(),
      done: Promise.resolve(),
      running: false,
      recheck: false,
    };
    inFlight.done = this.runIfHeld(inFlight);
    this.inFlight = inFlight;
    await inFlight.done;
    this.inFlight = undefined;
  }

  /** Run the duty when a run is due, checking again when a tick arrived while the check waited on the store. */
  private async runIfHeld(inFlight: RunInFlight): Promise<void> {
    let claimed = await this.claimRun();
    while (!claimed && inFlight.recheck && this.lease.holding && !this.lease.stopping) {
      inFlight.recheck = false;
      claimed = await this.claimRun();
    }
    if (!claimed) return;
    inFlight.running = true;
    try {
      await this.options.run({ signal: inFlight.controller.signal });
    } catch (error) {
      this.options.logger.error(`${this.label} failed: ${messageOf(error)}`);
    }
  }

  /** Renew the lease right before a run, so a holder that lost it while paused never runs, and mark the run. */
  private async claimRun(): Promise<boolean> {
    try {
      if (!(await this.lease.renew())) {
        this.lease.lose('lost its lease; another process runs it now');
        return false;
      }
      if (this.lease.stopping) return false;
      return await this.markRun();
    } catch (error) {
      this.lease.reportStoreFailure(error);
      return false;
    }
  }

  /**
   * An interval's mark lasts one interval, which tells the next holder how long to wait. A cron's is the time its
   * schedule was last taken, kept without expiry: there is a run only when a scheduled time passed since.
   */
  private async markRun(): Promise<boolean> {
    const { options } = this;
    if (options.cron) return takeDueRun(options.cron, options.storage, this.ranKey);
    const intervalSeconds = Math.max(1, Math.ceil(options.everyMs / 1_000));
    await options.storage.set(this.ranKey, this.lease.id, { ttlSeconds: intervalSeconds });
    return true;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
