import type { EventDeliveryErrorCategory } from '@frontmcp/protocol';
import { getMachineId, getRuntimeContext, randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { type EventsConfig } from '../../common/metadata/event.metadata';
import { deserializeAndDecrypt, encryptAndSerialize } from '../../elicitation/store/elicitation-encryption';
import { type EventMetrics } from './event-metrics';

/** What a delivery carries: an occurrence of an event, or the envelope that tells a callback its subscription ended. */
export type EventDeliveryKind = 'event' | 'terminated';

/** The callback and secrets of a delivery whose subscription is no longer stored. */
export interface EventDeliveryTarget {
  url: string;
  secret: string;
  previousSecret?: string;
  previousSecretUntil?: number;
}

export interface EventDeliveryRecord {
  id: string;
  kind: EventDeliveryKind;
  subscriptionId: string;
  eventName: string;
  /** The body, serialized once: these exact bytes are signed and sent on every attempt. */
  body: string;
  /** The `webhook-id`, the same on every attempt. */
  webhookId: string;
  /** How many attempts were made. */
  attempt: number;
  nextAttemptAt: number;
  firstAttemptAt: number;
  /** The process that holds the delivery until `leaseUntil`. */
  leaseOwner: string;
  leaseUntil: number;
  /** Set for a `terminated` envelope, whose subscription was removed before it is sent. */
  target?: EventDeliveryTarget;
}

/** What `enqueue` takes: the outbox adds the id, the attempt count, the times and the lease. */
export type NewEventDelivery = Pick<
  EventDeliveryRecord,
  'kind' | 'subscriptionId' | 'eventName' | 'body' | 'webhookId' | 'target'
>;

export type EventDeliveryOutcome =
  | { result: 'delivered' }
  | { result: 'dropped'; reason: 'gone' | 'refused' }
  | { result: 'failed'; category: EventDeliveryErrorCategory }
  | { result: 'waiting' };

export interface EventOutboxOptions {
  /** The storage of the subscription store: the outbox keeps its records under `outbox:`. */
  storage: NamespacedStorage;
  /** Encrypts each record, as the subscription store does. */
  secret?: string;
  /** Whether the storage outlives the process: only then can another process finish a delivery. */
  durable: boolean;
  settings: EventsConfig['webhook']['delivery'];
  /** Makes one attempt of a delivery. */
  attempt: (delivery: EventDeliveryRecord) => Promise<EventDeliveryOutcome>;
  metrics: EventMetrics;
  logger: FrontMcpLogger;
  /** @default Math.random */
  random?: () => number;
}

const RECORD_PREFIX = 'outbox:';
/** How often deliveries another process left behind are looked for. */
export const OUTBOX_SWEEP_INTERVAL_MS = 30_000;
/** How long after an attempt could have ended its lease is still held. */
const LEASE_MARGIN_MS = 30_000;
/** How long a delivery to a suspended subscription waits before it looks again. */
const SUSPENDED_RECHECK_MS = 30_000;

interface StoredDelivery {
  raw: string;
  record: EventDeliveryRecord;
}

/** An attempt that threw instead of answering with an outcome. */
interface AttemptError {
  result: 'error';
}

type UnfinishedOutcome = Extract<EventDeliveryOutcome, { result: 'failed' | 'waiting' }> | AttemptError;

/** Why a delivery was not completed, for the log line of an abandoned one. */
function reasonOf(outcome: UnfinishedOutcome): string {
  if (outcome.result === 'failed') return outcome.category;
  return outcome.result === 'waiting' ? 'the subscription is suspended' : 'the attempt could not be made';
}

/**
 * The handoff from publishing to delivery, at least once: each pending delivery is a stored record that the process
 * holding its lease attempts until it completes or is abandoned, and that another process takes over when the lease
 * expires.
 */
export class EventOutbox {
  private readonly ownerId: string;
  private readonly logger: FrontMcpLogger;
  private readonly random: () => number;
  private readonly usesTimers: boolean;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly waitingForSlot: Array<() => void> = [];
  private activeAttempts = 0;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;
  private stopped = false;

  /** Takes the storage, the delivery settings and the function that makes one attempt. */
  constructor(private readonly options: EventOutboxOptions) {
    this.ownerId = `${getMachineId()}:${randomUUID()}`;
    this.logger = options.logger.child('EventOutbox');
    this.random = options.random ?? Math.random;
    const { runtime, deployment } = getRuntimeContext();
    this.usesTimers = deployment !== 'serverless' && runtime !== 'edge' && runtime !== 'browser';
  }

  /** Store a delivery and attempt it: on a timer in a long-lived process, before returning elsewhere. */
  async enqueue(delivery: NewEventDelivery): Promise<void> {
    const now = Date.now();
    const record: EventDeliveryRecord = {
      ...delivery,
      id: `dlv_${randomUUID()}`,
      attempt: 0,
      nextAttemptAt: now,
      firstAttemptAt: now,
      leaseOwner: this.ownerId,
      leaseUntil: this.leaseEnd(now),
    };
    await this.options.storage.set(RECORD_PREFIX + record.id, await this.encode(record));
    if (this.usesTimers) {
      this.schedule(record.id, 0);
    } else {
      await this.run(record.id);
    }
  }

  /** Look for deliveries on a timer, where the process is long-lived and the storage is shared. */
  start(): void {
    if (!this.usesTimers || !this.options.durable) return;
    this.sweepInBackground();
    this.sweepTimer = setInterval(() => this.sweepInBackground(), OUTBOX_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /** Sweep when the last sweep is old enough: how retries and left-behind deliveries run without timers. */
  async sweepIfDue(now = Date.now()): Promise<void> {
    if (now - this.lastSweepAt < OUTBOX_SWEEP_INTERVAL_MS) return;
    await this.sweep(now);
  }

  /** Take the deliveries nobody holds: those whose lease expired, and this process's own that no timer runs. */
  async sweep(now = Date.now()): Promise<void> {
    this.lastSweepAt = now;
    if (!this.options.durable && this.usesTimers) return;
    const keys = await this.options.storage.keys(`${RECORD_PREFIX}*`);
    const dueAttempts: Promise<void>[] = [];
    for (const key of keys) {
      const id = key.slice(RECORD_PREFIX.length);
      if (this.timers.has(id) || this.inFlight.has(id)) continue;
      const claimed = await this.claim(id, now);
      if (!claimed) continue;
      if (this.usesTimers) {
        this.schedule(id, Math.max(0, claimed.nextAttemptAt - now));
      } else if (claimed.nextAttemptAt <= now) {
        dueAttempts.push(this.run(id));
      }
    }
    await Promise.all(dueAttempts);
  }

  /** How many deliveries are stored, waiting for an attempt. */
  async depth(): Promise<number> {
    return this.options.storage.count(`${RECORD_PREFIX}*`);
  }

  /** Stop the timers, wait for the attempts in flight, and leave unfinished deliveries for the next process to take. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.inFlight.values()]);
    await this.releaseLeases().catch((error: unknown) =>
      this.logger.warn('The outbox leases were not released', error),
    );
  }

  /** Give up the leases this process holds, so another process takes its deliveries without waiting for them to expire. */
  private async releaseLeases(): Promise<void> {
    if (!this.options.durable) return;
    const keys = await this.options.storage.keys(`${RECORD_PREFIX}*`);
    for (const key of keys) {
      const stored = await this.read(key.slice(RECORD_PREFIX.length));
      if (stored?.record.leaseOwner !== this.ownerId) continue;
      await this.replace(stored, { ...stored.record, leaseUntil: 0 });
    }
  }

  /** Run a delivery after `delayMs`, on a timer that does not keep the process alive. */
  private schedule(id: string, delayMs: number): void {
    if (this.stopped || this.timers.has(id)) return;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      void this.run(id);
    }, delayMs);
    timer.unref?.();
    this.timers.set(id, timer);
  }

  /** Make one attempt of a delivery, within the concurrency limit; a failure of the outbox itself is logged. */
  private run(id: string): Promise<void> {
    const running = this.inFlight.get(id);
    if (running) return running;
    const attempt = this.attemptWithinLimit(id)
      .catch((error: unknown) => this.logger.warn(`Delivery ${id} could not be attempted`, error))
      .finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, attempt);
    return attempt;
  }

  /** Take a slot or wait to be handed one, make the attempt, then hand the slot to the next waiter or free it. */
  private async attemptWithinLimit(id: string): Promise<void> {
    if (this.activeAttempts >= this.options.settings.concurrency) {
      await new Promise<void>((resolve) => this.waitingForSlot.push(resolve));
    } else {
      this.activeAttempts += 1;
    }
    try {
      await this.attemptOnce(id);
    } finally {
      const nextWaiter = this.waitingForSlot.shift();
      if (nextWaiter) nextWaiter();
      else this.activeAttempts -= 1;
    }
  }

  /** Renew the lease, attempt the delivery and act on its outcome. */
  private async attemptOnce(id: string): Promise<void> {
    const stored = await this.read(id);
    if (!stored || stored.record.leaseOwner !== this.ownerId) return;
    const startedAt = Date.now();
    const held = await this.replace(stored, { ...stored.record, leaseUntil: this.leaseEnd(startedAt) });
    if (!held) return;

    const outcome = await this.outcomeOf(held.record);
    if (outcome.result === 'delivered' || outcome.result === 'dropped') {
      await this.options.storage.delete(RECORD_PREFIX + id);
      this.options.metrics.count(outcome.result, held.record.eventName);
      return;
    }
    await this.retryOrAbandon(held, outcome);
  }

  /** The outcome of one attempt; an attempt that throws counts as a failed one, so the delivery is not left behind. */
  private async outcomeOf(record: EventDeliveryRecord): Promise<EventDeliveryOutcome | AttemptError> {
    try {
      return await this.options.attempt(record);
    } catch (error) {
      this.logger.warn(`The attempt of delivery ${record.id} threw`, error);
      return { result: 'error' };
    }
  }

  /** Keep a delivery for a later attempt, or give it up when its attempts or its retry window are used. */
  private async retryOrAbandon(held: StoredDelivery, outcome: UnfinishedOutcome): Promise<void> {
    const { settings, metrics, storage } = this.options;
    const { record } = held;
    const now = Date.now();
    const isWaiting = outcome.result === 'waiting';
    const attemptsMade = isWaiting ? record.attempt : record.attempt + 1;
    const windowIsOver = now - record.firstAttemptAt >= settings.retryWindowMs;
    if (attemptsMade >= settings.maxAttempts || windowIsOver) {
      await storage.delete(RECORD_PREFIX + record.id);
      metrics.count('abandoned', record.eventName);
      this.logger.warn(
        `Delivery ${record.id} of event "${record.eventName}" to subscription ${record.subscriptionId} is abandoned ` +
          `after ${attemptsMade} attempt(s): ${reasonOf(outcome)}`,
      );
      return;
    }

    const waitMs = isWaiting ? SUSPENDED_RECHECK_MS : this.backoffMs(attemptsMade);
    const nextAttemptAt = now + waitMs;
    const next = { ...record, attempt: attemptsMade, nextAttemptAt, leaseUntil: this.leaseEnd(nextAttemptAt) };
    if (!(await this.replace(held, next))) return;
    if (!isWaiting) metrics.count('retried', record.eventName);
    if (this.usesTimers) this.schedule(record.id, waitMs);
  }

  /** The wait before the next attempt: it doubles with each attempt up to the maximum, less a random part of half. */
  private backoffMs(attemptsMade: number): number {
    const { backoffMs, maxBackoffMs } = this.options.settings;
    const exponential = Math.min(maxBackoffMs, backoffMs * 2 ** (attemptsMade - 1));
    return Math.round(exponential * (0.5 + this.random() * 0.5));
  }

  /** When a lease taken for an attempt at `attemptAt` ends: after the attempt can no longer be running. */
  private leaseEnd(attemptAt: number): number {
    return attemptAt + this.options.settings.timeoutMs + LEASE_MARGIN_MS;
  }

  /** Take a delivery whose lease expired, or that this process already holds; undefined when another holds it. */
  private async claim(id: string, now: number): Promise<EventDeliveryRecord | undefined> {
    const stored = await this.read(id);
    if (!stored) return undefined;
    if (stored.record.leaseOwner === this.ownerId) return stored.record;
    if (stored.record.leaseUntil > now) return undefined;
    const claimed = { ...stored.record, leaseOwner: this.ownerId, leaseUntil: this.leaseEnd(now) };
    return (await this.replace(stored, claimed))?.record;
  }

  /** Replace a stored delivery only when it is still the one that was read. */
  private async replace(stored: StoredDelivery, next: EventDeliveryRecord): Promise<StoredDelivery | undefined> {
    const raw = await this.encode(next);
    const replaced = await this.options.storage.setIfEquals(RECORD_PREFIX + next.id, stored.raw, raw);
    return replaced ? { raw, record: next } : undefined;
  }

  /** The stored delivery with the exact value a compare-and-set needs; undefined when it is gone or unreadable. */
  private async read(id: string): Promise<StoredDelivery | undefined> {
    const raw = await this.options.storage.get(RECORD_PREFIX + id);
    if (raw === null) return undefined;
    const record = await this.decode(raw, id);
    return record ? { raw, record } : undefined;
  }

  /** The record as stored: encrypted when the outbox has a secret. */
  private async encode(record: EventDeliveryRecord): Promise<string> {
    const { secret } = this.options;
    if (secret === undefined) return JSON.stringify(record);
    return encryptAndSerialize(record, `events-outbox:${record.id}`, secret);
  }

  /** The record a stored value holds; undefined for one that cannot be read or belongs to another id. */
  private async decode(raw: string, id: string): Promise<EventDeliveryRecord | undefined> {
    const { secret } = this.options;
    try {
      const record =
        secret === undefined
          ? (JSON.parse(raw) as EventDeliveryRecord)
          : await deserializeAndDecrypt<EventDeliveryRecord>(raw, `events-outbox:${id}`, secret);
      return record?.id === id ? record : undefined;
    } catch {
      return undefined;
    }
  }

  /** Run a sweep nobody waits for; its failure is logged. */
  private sweepInBackground(): void {
    this.sweep().catch((error: unknown) => this.logger.warn('The outbox sweep failed', error));
  }
}
