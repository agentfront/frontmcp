import { type FuncType, type Type } from '@frontmcp/di';
import type { EventDeliveryMode, EventOccurrence } from '@frontmcp/protocol';

import { type EventMetadata } from '../metadata/event.metadata';
import { ExecutionContextBase, type ExecutionContextBaseArgs } from './execution-context.interface';

/** An event listed in `@App({ events })`: an `@Event` class or an `event()` function. */
export type EventType<T = unknown> = Type<T> | FuncType<T>;

export type EventCtorArgs = ExecutionContextBaseArgs & {
  metadata: EventMetadata;
};

/** The owner of a subscription, as the server knew them when it was created or last refreshed. */
export interface EventSubscriber {
  sub: string;
  iss?: string;
  tenantId?: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  claims: Record<string, unknown>;
}

/** An occurrence whose `data` has the type of the event's `payloadSchema`. */
export type EventOccurrenceOf<Payload> = Omit<EventOccurrence, 'data'> & { data: Payload };

/** The subscription a lifecycle hook is called for. */
export interface EventSubscriptionRef {
  id: string;
  name: string;
  mode: EventDeliveryMode;
  subscriber: EventSubscriber;
}

/** The client unsubscribed, the TTL lapsed, the push stream closed, or the server ended the subscription. */
export type EventUnsubscribeReason = 'unsubscribed' | 'expired' | 'closed' | 'terminated';

/** An event `check()` found; the server gives it an `eventId` and a `timestamp` when it has none. */
export interface EventCheckItem<Payload> {
  data: Payload;
  eventId?: string;
  timestamp?: string;
}

export interface EventCheckResult<Payload> {
  events: EventCheckItem<Payload>[];
  /** The position after these events, or `null` when the upstream cannot replay. */
  cursor: string | null;
  truncated?: boolean;
  nextPollMs?: number;
}

declare const EVENT_TYPES: unique symbol;

/** Carries the argument and payload types of an event; it has no runtime value. */
export interface EventTyping<In, Payload> {
  readonly [EVENT_TYPES]?: { input: In; payload: Payload };
}

type MaybePromise<T> = T | Promise<T>;

/** Base class of an `@Event` class. Its methods are optional: without them, every subscription gets each event as published. */
export abstract class EventContext<In = Record<string, unknown>, Payload = Record<string, unknown>>
  extends ExecutionContextBase<void>
  implements EventTyping<In, Payload>
{
  declare readonly [EVENT_TYPES]?: { input: In; payload: Payload };

  readonly metadata: EventMetadata;

  constructor(args: EventCtorArgs) {
    const { metadata, providers, logger, authInfo, signal } = args;
    super({ providers, logger: logger.child(`event:${metadata.name}`), authInfo, signal });
    this.metadata = metadata;
  }

  /** Throw to refuse a subscription the event's `authorities` allow. */
  authorize?(args: In, subscriber: EventSubscriber): MaybePromise<void>;

  /** Whether a subscription receives a published event. Without it, every subscription of the event does. */
  match?(event: EventOccurrenceOf<Payload>, args: In, subscriber: EventSubscriber): MaybePromise<boolean>;

  /** The event as one subscription receives it. */
  transform?(
    event: EventOccurrenceOf<Payload>,
    args: In,
    subscriber: EventSubscriber,
  ): MaybePromise<EventOccurrenceOf<Payload>>;

  /** The events since `cursor`, for an upstream that can replay. A `null` cursor asks for the current position. */
  check?(args: In, cursor: string | null): MaybePromise<EventCheckResult<Payload>>;

  onSubscribe?(args: In, subscription: EventSubscriptionRef): MaybePromise<void>;

  onUnsubscribe?(args: In, subscription: EventSubscriptionRef, reason: EventUnsubscribeReason): MaybePromise<void>;
}

/** The optional methods of an event, as `event()` takes them. */
export type EventHandlers<In = Record<string, unknown>, Payload = Record<string, unknown>> = Pick<
  EventContext<In, Payload>,
  'authorize' | 'match' | 'transform' | 'check' | 'onSubscribe' | 'onUnsubscribe'
>;

/** What `event()` returns: list it in `@App({ events })`. */
export type EventFunction<In = Record<string, unknown>, Payload = Record<string, unknown>> = (() => EventHandlers<
  In,
  Payload
>) &
  EventTyping<In, Payload>;
