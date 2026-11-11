import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import type { FrontMcpLogger } from '../common';
import { describeThrown } from './describe-thrown';

/** The store operations a lease needs; the SQLite, Redis and memory stores run each one atomically. */
export type LeaseStorage = Pick<NamespacedStorage, 'set' | 'expireIfEquals' | 'deleteIfEquals'>;

export interface LeaseHolderOptions {
  /** What holds the lease, as logs name it: `Duty "sweep"`, `Worker "inbox"`. */
  label: string;
  key: string;
  leaseMs: number;
  storage: LeaseStorage;
  logger: Pick<FrontMcpLogger, 'info' | 'warn'>;
  /** This process got the lease. */
  onAcquired(): void | Promise<void>;
  /** This process no longer holds the lease, which it did not release itself: stop what runs under it. */
  onLost(): void;
}

/**
 * Holds a lease while this process can, and contends for it otherwise. The lease is a key holding this holder's id
 * with a TTL, so it expires by the store's clock when the holder stops renewing it. The holder renews it every third
 * of `leaseMs`, and gives it up a third of `leaseMs` before the store could end it, so what runs under it has that
 * long to end before another process can take the lease over.
 */
export class LeaseHolder {
  /** What this holder writes as the lease's value. */
  readonly id: string;
  private readonly leaseSeconds: number;
  /** How long after a renew was sent the holder trusts it: two thirds of `leaseMs`. */
  private readonly holdMs: number;
  private held = false;
  private stopped = false;
  private settled = false;
  private reportedHeldElsewhere = false;
  private leaseCheck?: Promise<void>;
  private leaseTimer?: ReturnType<typeof setTimeout>;
  private leaseDeadline?: ReturnType<typeof setTimeout>;

  /** Takes the lease's key, store and length, and draws this holder's random id. */
  constructor(private readonly options: LeaseHolderOptions) {
    this.id = randomUUID();
    this.leaseSeconds = Math.ceil(options.leaseMs / 1_000);
    this.holdMs = Math.round(options.leaseMs - options.leaseMs / 3);
  }

  /** Whether this process holds the lease now. */
  get holding(): boolean {
    return this.held;
  }

  /** Whether `stop()` was called: nothing new starts under the lease from then on. */
  get stopping(): boolean {
    return this.stopped;
  }

  /** Contend for the lease once now, then renew or contend again every third of the lease. */
  async start(): Promise<void> {
    this.leaseCheck = this.checkLease();
    await this.leaseCheck;
  }

  /**
   * Stop contending, keep renewing the lease until `untilSettled` resolves (what ran under it has ended), then
   * release it. When it resolves `false` (what ran did not end), stop renewing without releasing: the lease then ends
   * by the store's TTL.
   */
  async stop(untilSettled: () => boolean | void | Promise<boolean | void>): Promise<void> {
    this.stopped = true;
    const ended = (await untilSettled()) !== false;
    this.settled = true;
    clearTimeout(this.leaseTimer);
    await this.leaseCheck;
    clearTimeout(this.leaseDeadline);
    if (!this.held) return;
    this.held = false;
    if (!ended) return;
    try {
      await this.options.storage.deleteIfEquals(this.options.key, this.id);
    } catch (error) {
      this.reportStoreFailure(error);
    }
  }

  /** Extend the lease while it holds this holder's id, and give up holding it before the store could end it. */
  async renew(): Promise<boolean> {
    const sentAt = performance.now();
    const renewed = await this.options.storage.expireIfEquals(this.options.key, this.id, this.leaseSeconds);
    if (renewed) this.holdUntil(sentAt + this.holdMs);
    return renewed;
  }

  /** Stop holding the lease without releasing it: the store already gave it, or may give it, to another process. */
  lose(reason: string): void {
    if (!this.held) return;
    this.held = false;
    clearTimeout(this.leaseDeadline);
    this.options.onLost();
    this.options.logger.warn(`${this.options.label} ${reason}`);
  }

  /** Log a warning that the lease store failed, with the error's message. */
  reportStoreFailure(error: unknown): void {
    this.options.logger.warn(`${this.options.label}: the lease store failed: ${describeThrown(error)}`);
  }

  /**
   * Renew the lease if held, or contend for it, then schedule the next check a third of the lease later, or half that
   * after a renew failed, so a second try comes before the holder gives the lease up.
   */
  private async checkLease(): Promise<void> {
    let nextCheckMs = this.options.leaseMs / 3;
    try {
      if (this.held) {
        if (!(await this.renew())) this.lose('lost its lease; another process runs it now');
      } else if (!this.stopped) {
        const acquired = await this.acquire();
        if (!acquired) this.reportHeldElsewhere();
        // stop() may have begun meanwhile: it then releases the lease instead
        else if (!this.stopped) await this.options.onAcquired();
      }
    } catch (error) {
      this.reportStoreFailure(error);
      if (this.held) nextCheckMs /= 2;
    }
    if (this.settled) return;
    this.leaseTimer = setTimeout(() => {
      this.leaseCheck = this.checkLease();
    }, nextCheckMs);
    this.leaseTimer.unref?.();
  }

  /** Write the lease if no one holds it, then renew it to learn whether this holder's id is stored. */
  private async acquire(): Promise<boolean> {
    const { key, storage } = this.options;
    await storage.set(key, this.id, { ttlSeconds: this.leaseSeconds, ifNotExists: true });
    this.held = await this.renew();
    return this.held;
  }

  /**
   * Stop at `deadline` (monotonic) unless a renew succeeds first: the store ends the lease a third of `leaseMs` later
   * at the soonest, so what runs under it has that long to end before another process could take the lease over, even
   * while the store can't be reached.
   */
  private holdUntil(deadline: number): void {
    clearTimeout(this.leaseDeadline);
    this.leaseDeadline = setTimeout(
      () =>
        this.lose(`could not renew its lease within ${this.holdMs} ms; it stops here until it gets the lease again`),
      deadline - performance.now(),
    );
    this.leaseDeadline.unref?.();
  }

  /** Log once that another process holds the lease. */
  private reportHeldElsewhere(): void {
    if (this.reportedHeldElsewhere) return;
    this.reportedHeldElsewhere = true;
    const { label, key, logger } = this.options;
    logger.info(`${label} already runs elsewhere (lease "${key}"); this one takes it over if that one stops`);
  }
}
