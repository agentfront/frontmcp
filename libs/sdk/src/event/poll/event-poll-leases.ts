import { getRuntimeContext } from '@frontmcp/utils';

import {
  type EventContext,
  type EventSubscriptionRef,
  type EventUnsubscribeReason,
  type FrontMcpLogger,
} from '../../common';

/** A poll subscription the server keeps alive while its key keeps polling. */
interface PollLease {
  subscription: EventSubscriptionRef;
  arguments: Record<string, unknown>;
  /** The owner's key, or undefined for the lease anonymous callers share. */
  principalKey: string | undefined;
  expiresAt: number;
  /** Tells the event the subscription ended. */
  end: (reason: EventUnsubscribeReason) => Promise<void>;
}

export interface PollLeaseRequest {
  subscription: EventSubscriptionRef;
  arguments: Record<string, unknown>;
  principalKey: string | undefined;
  /** How long the lease lasts without another poll. */
  leaseMs: number;
  /** The event's context, whose `onSubscribe` and `onUnsubscribe` the lease calls. */
  context: EventContext;
}

export interface EventPollLeasesOptions {
  /** `events.subscriptions.maxPerPrincipal`. */
  maxPerPrincipal: number;
  logger: FrontMcpLogger;
}

/** The shortest a poll lease lasts, whatever the poll interval. */
export const POLL_LEASE_MIN_MS = 300_000;
/** How many poll intervals a lease lasts. */
export const POLL_LEASE_INTERVALS = 5;
/** How often lapsed leases are looked for. */
export const POLL_LEASE_SWEEP_INTERVAL_MS = 60_000;
/** How many poll leases one process keeps, for all callers together. */
export const MAX_POLL_LEASES = 10_000;

/** How long a poll lease lasts for a poll interval: five intervals, and at least five minutes. */
export function pollLeaseMs(nextPollMs: number): number {
  return Math.max(POLL_LEASE_MIN_MS, POLL_LEASE_INTERVALS * nextPollMs);
}

/**
 * The lifecycle of poll subscriptions. Poll has no goodbye, so a subscription is a lease its polls renew: `onSubscribe`
 * runs at the first poll of a key, `onUnsubscribe(..., 'expired')` when no poll renewed it in time. In memory only.
 */
export class EventPollLeases {
  private readonly leases = new Map<string, PollLease>();
  private readonly logger: FrontMcpLogger;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;

  constructor(private readonly options: EventPollLeasesOptions) {
    this.logger = options.logger.child('EventPollLeases');
  }

  /** How many leases are alive. */
  get size(): number {
    return this.leases.size;
  }

  /** Whether a new lease would exceed what one owner, or the process, may hold. */
  isFull(principalKey: string | undefined): boolean {
    if (this.leases.size >= MAX_POLL_LEASES) return true;
    if (principalKey === undefined) return false;
    let held = 0;
    for (const lease of this.leases.values()) {
      if (lease.principalKey === principalKey) held += 1;
    }
    return held >= this.options.maxPerPrincipal;
  }

  /** Whether the subscription already has a lease. */
  has(subscriptionId: string): boolean {
    return this.leases.has(subscriptionId);
  }

  /** Renew the lease of a poll, or start it: a new lease calls the event's `onSubscribe` first. */
  async renew(request: PollLeaseRequest): Promise<void> {
    const { subscription, context, leaseMs } = request;
    const now = Date.now();
    this.sweepIfDue(now);
    const lease = this.leases.get(subscription.id);
    if (lease) {
      lease.expiresAt = now + leaseMs;
      return;
    }
    await context.onSubscribe?.(request.arguments, subscription);
    this.leases.set(subscription.id, {
      subscription,
      arguments: request.arguments,
      principalKey: request.principalKey,
      expiresAt: now + leaseMs,
      end: async (reason) => {
        await context.onUnsubscribe?.(request.arguments, subscription, reason);
      },
    });
  }

  /** End every lease no poll renewed in time. */
  async sweep(now = Date.now()): Promise<void> {
    this.lastSweepAt = now;
    for (const [subscriptionId, lease] of this.leases) {
      if (lease.expiresAt > now) continue;
      this.leases.delete(subscriptionId);
      await this.end(lease, 'expired');
    }
  }

  /** Look for lapsed leases on a timer, where the process is long-lived. */
  start(): void {
    const { runtime, deployment } = getRuntimeContext();
    if (deployment === 'serverless' || runtime === 'edge' || runtime === 'browser') return;
    this.sweepTimer = setInterval(() => this.sweepInBackground(Date.now()), POLL_LEASE_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /** Stop the timer and forget the leases: a restart starts them again at the next poll. */
  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    this.leases.clear();
  }

  /** Sweep in the background when the last sweep is old enough: the only sweep where no timer runs. */
  private sweepIfDue(now: number): void {
    if (now - this.lastSweepAt < POLL_LEASE_SWEEP_INTERVAL_MS) return;
    this.sweepInBackground(now);
  }

  /** Run a sweep nobody waits for; its failure is logged. */
  private sweepInBackground(now: number): void {
    this.sweep(now).catch((error: unknown) => this.logger.warn('The poll lease sweep failed', error));
  }

  /** Tell the event a lease ended; a failure there is logged, never thrown. */
  private async end(lease: PollLease, reason: EventUnsubscribeReason): Promise<void> {
    try {
      await lease.end(reason);
    } catch (error) {
      const { id, name } = lease.subscription;
      this.logger.warn(`onUnsubscribe of event "${name}" failed for poll subscription ${id}`, error);
    }
  }
}
