import type { EventDeliveryErrorCategory } from '@frontmcp/protocol';

import { type EventSubscriber, type EventSubscriptionRef } from '../common';
import { type EventDialect } from './event-dialect';
import { type EventSubscriptionRecord } from './subscription/event-subscription.store';

/** Who owns a listed subscription: the subject, and the issuer and tenant when known. No claims, roles or scopes. */
export interface EventSubscriberSummary {
  sub: string;
  iss?: string;
  tenantId?: string;
}

/** What every listed subscription has, whatever its delivery mode. */
export interface EventSubscriptionInfoBase {
  /** The subscription's id, as its event's `onSubscribe` and `onUnsubscribe` get it. */
  id: string;
  eventName: string;
  /** `principal:<iss>#<sub>`, or `principal:<sub>`; undefined for the poll lease or stream anonymous callers share. */
  principalKey: string | undefined;
  subscriber: EventSubscriberSummary;
  /** The arguments, as the event's input schema parsed them. */
  arguments: Record<string, unknown>;
}

/** Where a webhook subscription's deliveries stand. The callback appears as its host only. */
export interface EventWebhookSubscriptionDelivery {
  /** The host (and port) of the callback URL: no scheme, path, query or credentials. */
  host: string;
  /** Failed delivery attempts in a row; an acknowledged delivery ends the count. */
  failures: number;
  /** When delivery was suspended, while it is. */
  suspendedSince?: number;
  lastDeliveryAt?: number;
  lastError?: EventDeliveryErrorCategory;
  /** When the current run of failures began. */
  failedSince?: number;
}

/** A webhook subscription, from the store every process of the server shares. */
export interface EventWebhookSubscriptionInfo extends EventSubscriptionInfoBase {
  mode: 'webhook';
  principalKey: string;
  dialect: EventDialect;
  createdAt: number;
  /** When the last `events/subscribe` created or refreshed it. */
  updatedAt: number;
  /** When it ends, in Unix milliseconds; `null` for one that never expires. */
  expiresAt: number | null;
  verifiedAt: number | null;
  lastAuthorizedAt: number;
  /** `false` while delivery is suspended; the next `events/subscribe` sets it again. */
  active: boolean;
  delivery: EventWebhookSubscriptionDelivery;
}

/** A poll subscription's lease, held by this process: it lasts while the caller keeps polling. */
export interface EventPollSubscriptionInfo extends EventSubscriptionInfoBase {
  mode: 'poll';
  /** When the lease lapses unless another poll renews it, in Unix milliseconds. */
  expiresAt: number;
}

/** An open `events/stream` request, held by this process. */
export interface EventStreamSubscriptionInfo extends EventSubscriptionInfoBase {
  mode: 'push';
}

/**
 * A subscription as `scope.events.listSubscriptions()` lists it. It holds no webhook secret or signing key, no callback
 * URL (only its host), and none of the owner's claims.
 */
export type EventSubscriptionInfo =
  | EventWebhookSubscriptionInfo
  | EventPollSubscriptionInfo
  | EventStreamSubscriptionInfo;

/** The owner as a listing shows it. */
export function subscriberSummaryOf(subscriber: EventSubscriber): EventSubscriberSummary {
  return {
    sub: subscriber.sub,
    ...(subscriber.iss !== undefined && { iss: subscriber.iss }),
    ...(subscriber.tenantId !== undefined && { tenantId: subscriber.tenantId }),
  };
}

/** The host of a callback URL; empty for one that does not parse, which a stored subscription never has. */
function callbackHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** A stored webhook subscription without its secrets, its callback URL or its owner's claims. */
export function webhookSubscriptionInfoOf(record: EventSubscriptionRecord): EventWebhookSubscriptionInfo {
  const { lastDeliveryAt, lastError, failedSince, failures, suspendedSince } = record.status;
  return {
    id: record.id,
    eventName: record.eventName,
    mode: 'webhook',
    principalKey: record.principalKey,
    subscriber: subscriberSummaryOf(record.subscriber),
    arguments: record.arguments,
    dialect: record.dialect,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    verifiedAt: record.verifiedAt,
    lastAuthorizedAt: record.lastAuthorizedAt,
    active: record.active,
    delivery: {
      host: callbackHostOf(record.delivery.url),
      failures: failures ?? 0,
      ...(suspendedSince !== undefined && { suspendedSince }),
      ...(lastDeliveryAt !== undefined && { lastDeliveryAt }),
      ...(lastError !== undefined && { lastError }),
      ...(failedSince !== undefined && { failedSince }),
    },
  };
}

/** A poll lease or a stream, from the subscription its event's lifecycle methods get. */
export function heldSubscriptionInfoOf(
  subscription: EventSubscriptionRef,
  principalKey: string | undefined,
  args: Record<string, unknown>,
): EventSubscriptionInfoBase {
  return {
    id: subscription.id,
    eventName: subscription.name,
    principalKey,
    subscriber: subscriberSummaryOf(subscription.subscriber),
    arguments: args,
  };
}
