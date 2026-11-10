import type { AuthInfo, EventDeliveryStatus } from '@frontmcp/protocol';
import { canonicalJson, getRuntimeContext, sha256Hex } from '@frontmcp/utils';

import {
  type EventEntry,
  type EventSubscriptionRef,
  type EventUnsubscribeReason,
  type FrontMcpLogger,
} from '../../common';
import { type EventsConfig } from '../../common/metadata/event.metadata';
import { type EventCallbackVerifier } from './event-callback-verifier';
import {
  type EventSubscriptionRecord,
  type EventSubscriptionStore,
  type EventWebhookDelivery,
} from './event-subscription.store';

export interface EventSubscriptionsOptions {
  /** The registered events, by name. */
  events: { findByName(name: string): EventEntry | undefined };
  store: EventSubscriptionStore;
  /** Whether the store outlives the process; a subscription without expiry needs one that does. */
  durable: boolean;
  verifier: EventCallbackVerifier;
  settings: EventsConfig['subscriptions'];
  /** `events.webhook.rotationGraceMs`. */
  rotationGraceMs: number;
  logger: FrontMcpLogger;
}

export interface EventSubscriptionIdentity {
  id: string;
  /** The canonical JSON of the arguments. */
  argumentsKey: string;
}

/** How often expired subscriptions are looked for. */
export const SUBSCRIPTION_SWEEP_INTERVAL_MS = 60_000;

/** The value kept within `lowest` and `highest`. */
function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

/** The subscription as an event's lifecycle methods see it. */
export function subscriptionRefOf(record: EventSubscriptionRecord): EventSubscriptionRef {
  return { id: record.id, name: record.eventName, mode: record.delivery.mode, subscriber: record.subscriber };
}

/** A time in Unix milliseconds as an ISO 8601 string, or `null` without one. */
function isoTimeOf(time: number | undefined): string | null {
  return time === undefined ? null : new Date(time).toISOString();
}

/** The delivery status a client reads on a refresh. */
export function deliveryStatusOf(record: EventSubscriptionRecord): EventDeliveryStatus {
  const { lastDeliveryAt, lastError, failedSince } = record.status;
  return {
    active: record.active,
    lastDeliveryAt: isoTimeOf(lastDeliveryAt),
    lastError: lastError ?? null,
    failedSince: isoTimeOf(failedSince),
  };
}

/** The stored subscriptions of a server: their identity, their lifetime, and the event methods their life calls. */
export class EventSubscriptions {
  readonly store: EventSubscriptionStore;
  readonly verifier: EventCallbackVerifier;
  private readonly logger: FrontMcpLogger;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private lastSweepAt = 0;

  constructor(private readonly options: EventSubscriptionsOptions) {
    this.store = options.store;
    this.verifier = options.verifier;
    this.logger = options.logger.child('EventSubscriptions');
  }

  /** The limits of `events.subscriptions`, with their defaults. */
  get settings(): EventsConfig['subscriptions'] {
    return this.options.settings;
  }

  /** The identity of a subscription: the same owner, callback, event and arguments always give the same id. */
  identityOf(
    principalKey: string,
    url: string,
    eventName: string,
    args: Record<string, unknown>,
  ): EventSubscriptionIdentity {
    const canonicalKey = canonicalJson({ principalKey, url, name: eventName, arguments: args });
    return { id: `sub_${sha256Hex(canonicalKey).slice(0, 32)}`, argumentsKey: canonicalJson(args) };
  }

  /** When a subscription that asks for `requestedTtlMs` ends: `null` only for a granted request for no expiry. */
  grantExpiry(event: EventEntry, requestedTtlMs: number | null | undefined, now: number): number | null {
    const { defaultTtlMs, maxTtlMs, minTtlMs, allowNoExpiry } = this.options.settings;
    const eventTtl = event.metadata.ttl;
    const longestMs = Math.min(eventTtl?.maxMs ?? maxTtlMs, maxTtlMs);
    const shortestMs = Math.min(minTtlMs, longestMs);

    if (requestedTtlMs === null) {
      const grantsNoExpiry = allowNoExpiry && this.options.durable && eventTtl?.maxMs === undefined;
      return grantsNoExpiry ? null : now + longestMs;
    }
    if (requestedTtlMs === undefined) {
      return now + clamp(eventTtl?.defaultMs ?? defaultTtlMs, shortestMs, longestMs);
    }
    return now + clamp(requestedTtlMs, shortestMs, longestMs);
  }

  /** The delivery of a subscription after a refresh: a replaced secret keeps signing until the grace ends. */
  rotatedDelivery(
    current: EventWebhookDelivery | undefined,
    url: string,
    secret: string,
    now: number,
  ): EventWebhookDelivery {
    const delivery: EventWebhookDelivery = { mode: 'webhook', url, secret };
    if (!current) return delivery;
    if (current.secret !== secret) {
      return { ...delivery, previousSecret: current.secret, previousSecretUntil: now + this.options.rotationGraceMs };
    }
    const graceIsRunning = current.previousSecret !== undefined && (current.previousSecretUntil ?? 0) > now;
    if (!graceIsRunning) return delivery;
    return { ...delivery, previousSecret: current.previousSecret, previousSecretUntil: current.previousSecretUntil };
  }

  /** Call the event's `onSubscribe` for a subscription that was just created. */
  async notifySubscribed(
    event: EventEntry,
    record: EventSubscriptionRecord,
    authInfo: Partial<AuthInfo>,
  ): Promise<void> {
    await event.create(authInfo).onSubscribe?.(record.arguments, subscriptionRefOf(record));
  }

  /** Call the event's `onUnsubscribe` for a removed subscription; a failure there is logged, never thrown. */
  async notifyUnsubscribed(
    record: EventSubscriptionRecord,
    reason: EventUnsubscribeReason,
    authInfo: Partial<AuthInfo> = {},
  ): Promise<void> {
    const event = this.options.events.findByName(record.eventName);
    if (!event) return;
    try {
      await event.create(authInfo).onUnsubscribe?.(record.arguments, subscriptionRefOf(record), reason);
    } catch (error) {
      this.logger.warn(`onUnsubscribe of event "${record.eventName}" failed for subscription ${record.id}`, error);
    }
  }

  /** End one subscription whose lifetime is over, telling its event once across every node. */
  async expire(id: string, now = Date.now()): Promise<void> {
    const removed = await this.store.deleteExpired(id, now);
    if (removed) await this.notifyUnsubscribed(removed, 'expired');
  }

  /** End every subscription whose lifetime is over. */
  async sweep(now = Date.now()): Promise<void> {
    this.lastSweepAt = now;
    const expired = await this.store.listExpired(now);
    for (const record of expired) {
      await this.expire(record.id, now);
    }
  }

  /** Sweep in the background when the last sweep is old enough: the only sweep on serverless and edge runtimes. */
  sweepIfDue(now = Date.now()): void {
    if (now - this.lastSweepAt < SUBSCRIPTION_SWEEP_INTERVAL_MS) return;
    this.sweepInBackground(now);
  }

  /** Sweep on a timer, where the process is long-lived. */
  start(): void {
    const { runtime, deployment } = getRuntimeContext();
    if (deployment === 'serverless' || runtime === 'edge' || runtime === 'browser') return;
    this.sweepTimer = setInterval(() => this.sweepInBackground(Date.now()), SUBSCRIPTION_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /** Stop the timer and close the store. */
  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    await this.store.close();
  }

  /** Run a sweep nobody waits for; its failure is logged. */
  private sweepInBackground(now: number): void {
    this.sweep(now).catch((error: unknown) => this.logger.warn('The subscription expiry sweep failed', error));
  }
}
