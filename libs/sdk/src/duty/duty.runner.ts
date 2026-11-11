import { type NamespacedStorage } from '@frontmcp/utils';

import type { DutyRunContext, FrontMcpLogger } from '../common';
import {
  claimDueRun,
  settleCronClaim,
  type CronClaim,
  type CronLedgerStorage,
  type CronSchedule,
} from './cron-schedule';
import { describeThrown } from './describe-thrown';
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
  /** `scheduledAt` names the run: the cron time it is for, or when an interval's run was taken. */
  run(context: DutyRunContext, scheduledAt: number): unknown;
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
  /**
   * Keep each taken run owed in the store until `run()` returns, so a process that takes the lease over after this one
   * died before then runs it again, with the same `scheduledAt`. Without it a run is taken for good before it starts.
   */
  owedUntilRun?: boolean;
}

export type DutyRunnerOptions = IntervalDutyRunnerOptions | CronDutyRunnerOptions;

const MAX_TIMER_MS = 2_147_483_647;

/** A run this process took: the time that names it, and for a cron the ledger's claim. */
interface TakenRun {
  scheduledAt: number;
  claim?: CronClaim;
}

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

  /** Whether this process holds the duty's lease now. */
  get holdsLease(): boolean {
    return this.lease.holding;
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

  /** Cancel the next tick and abort the run in flight. */
  private stopRunning(): void {
    clearTimeout(this.tickTimer);
    this.inFlight?.controller.abort();
  }

  /** Once the lease is acquired, log the cadence and schedule the first tick. */
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
    let taken = await this.claimRun();
    while (!taken && inFlight.recheck && this.lease.holding && !this.lease.stopping) {
      inFlight.recheck = false;
      taken = await this.claimRun();
    }
    if (!taken) return;
    inFlight.running = true;
    try {
      await this.options.run({ signal: inFlight.controller.signal }, taken.scheduledAt);
    } catch (error) {
      this.options.logger.error(`${this.label} failed: ${describeThrown(error)}`);
    }
    await this.settle(taken);
  }

  /** Renew the lease right before a run, so a holder that lost it while paused never runs, and mark the run. */
  private async claimRun(): Promise<TakenRun | undefined> {
    try {
      if (!(await this.lease.renew())) {
        this.lease.lose('lost its lease; another process runs it now');
        return undefined;
      }
      if (this.lease.stopping) return undefined;
      return await this.markRun();
    } catch (error) {
      this.lease.reportStoreFailure(error);
      return undefined;
    }
  }

  /**
   * An interval's mark lasts one interval, which tells the next holder how long to wait. A cron's is the time its
   * schedule was last taken, kept without expiry: there is a run only when a scheduled time passed since.
   */
  private async markRun(): Promise<TakenRun | undefined> {
    const { options } = this;
    if (options.cron) {
      const claim = await claimDueRun(options.cron, options.storage, this.ranKey, options.owedUntilRun);
      return claim && { scheduledAt: claim.scheduledAt, claim };
    }
    const intervalSeconds = Math.max(1, Math.ceil(options.everyMs / 1_000));
    await options.storage.set(this.ranKey, this.lease.id, { ttlSeconds: intervalSeconds });
    return { scheduledAt: Date.now() };
  }

  /** Record that the run of an owed claim started; a claim still owed after a store failure is taken again later. */
  private async settle({ claim }: TakenRun): Promise<void> {
    const { options } = this;
    if (!options.cron || !options.owedUntilRun || !claim) return;
    try {
      await settleCronClaim(options.storage, this.ranKey, claim);
    } catch (error) {
      this.lease.reportStoreFailure(error);
    }
  }
}
