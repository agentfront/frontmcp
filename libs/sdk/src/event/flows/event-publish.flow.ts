import { internalZ as z } from '@frontmcp/lazy-zod';
import { EventOccurrenceSchema, type EventOccurrence } from '@frontmcp/protocol';
import { sha256Hex } from '@frontmcp/utils';

import {
  EventEntry,
  Flow,
  FlowBase,
  FlowHooksOf,
  type EventAudience,
  type EventContext,
  type EventSubscriber,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { EventNotRegisteredError } from '../../errors';
import { EVENT_DIALECTS } from '../event-dialect';
import { hasReauthorization, reauthorizeSubscriber } from '../event-reauthorization';
import type EventRegistry from '../event.registry';
import { type BufferedEvent } from '../poll/event-buffer';
import {
  accessRevokedError,
  terminateEventSubscription,
  type EventTerminationError,
} from '../subscription/event-subscription-termination';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';

/** The largest body of one delivery, in bytes. A larger event is not delivered to that subscription. */
export const EVENT_DELIVERY_MAX_BYTES = 262_144;

/** One subscription a published event goes to, with the event as that subscription receives it. */
export interface EventDeliveryPlan {
  subscription: EventSubscriptionRecord;
  occurrence: EventOccurrence;
  /** The serialized occurrence, set once it is known to fit. */
  body?: string;
}

const audienceValueSchema = z.union([z.string(), z.array(z.string())]);

const inputSchema = z.object({
  occurrence: EventOccurrenceSchema,
  subscriptionId: z.string().optional(),
  audience: z
    .object({
      sub: audienceValueSchema.optional(),
      tenantId: audienceValueSchema.optional(),
      roles: z.object({ any: z.array(z.string()).optional(), all: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

const outputSchema = z.object({
  eventId: z.string(),
  matched: z.number().int().nonnegative(),
});

const stateSchema = z.object({
  event: z.instanceof(EventEntry),
  context: z.any() as z.ZodType<EventContext>,
  subscriptions: z.array(z.any() as z.ZodType<EventSubscriptionRecord>),
  deliveries: z.array(z.any() as z.ZodType<EventDeliveryPlan>),
  buffered: z.any() as z.ZodType<BufferedEvent | undefined>,
});

const plan = {
  pre: ['validate', 'bufferOccurrence', 'pushToStreams'],
  execute: [
    'loadSubscriptions',
    'dropInactive',
    'filterByAudience',
    'reauthorize',
    'match',
    'transform',
    'enforceBodyLimit',
    'enqueue',
    'bridgeToBus',
  ],
  post: ['buildResult'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:publish': FlowRunOptions<
      EventPublishFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

/** The `webhook-id` of one event on one subscription: a publish the client repeats sends the same one, to deduplicate. */
export function eventWebhookIdOf(subscriptionId: string, eventId: string): string {
  return `msg_${sha256Hex(`${subscriptionId}\u0000${eventId}`).slice(0, 32)}`;
}

const name = 'events:publish' as const;
const { Stage } = FlowHooksOf<'events:publish'>(name);
const encoder = new TextEncoder();

/** Whether a value is the one an audience names, or one of several. */
function isNamed(wanted: string | string[] | undefined, actual: string | undefined): boolean {
  if (wanted === undefined) return true;
  if (actual === undefined) return false;
  return Array.isArray(wanted) ? wanted.includes(actual) : wanted === actual;
}

/** Whether the owner of a subscription is in the audience of a published event. */
export function isInAudience(audience: EventAudience | undefined, subscriber: EventSubscriber): boolean {
  if (!audience) return true;
  const { any: anyOf, all: allOf } = audience.roles ?? {};
  const hasOneOf = !anyOf || anyOf.some((role) => subscriber.roles.includes(role));
  const hasEveryOf = !allOf || allOf.every((role) => subscriber.roles.includes(role));
  return (
    isNamed(audience.sub, subscriber.sub) && isNamed(audience.tenantId, subscriber.tenantId) && hasOneOf && hasEveryOf
  );
}

/** `events:publish`: queue one delivery of a published event for each subscription that should receive it. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
})
export default class EventPublishFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventPublishFlow');

  /** The event registry of the scope: the flow is registered with it. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** Find the event and the context its `match` and `transform` run on. */
  @Stage('validate')
  async validate() {
    const eventName = this.input.occurrence.name;
    const event = this.events.findByName(eventName);
    if (!event) throw new EventNotRegisteredError(eventName);
    this.events.metrics?.count('published', eventName);
    this.state.set({ event, context: event.create({}), deliveries: [] });
  }

  /** Keep the occurrence for `events/poll` and `events/stream`, before any filter; an event neither offers is not kept. */
  @Stage('bufferOccurrence')
  async bufferOccurrence() {
    const { occurrence, audience, subscriptionId } = this.input;
    const modes = this.events.deliveryModesOf(this.state.required.event);
    if (!modes.includes('poll') && !modes.includes('push')) return;
    this.state.set('buffered', this.events.buffer?.append(occurrence, audience, subscriptionId));
  }

  /** Push the occurrence on the open `events/stream` requests of its event: each stream filters for its reader. */
  @Stage('pushToStreams')
  async pushToStreams() {
    const { buffered } = this.state;
    if (buffered) await this.events.streams?.publish(buffered);
  }

  /** Load the subscriptions of the event, or the one a targeted publish names. */
  @Stage('loadSubscriptions')
  async loadSubscriptions() {
    const { subscriptions, outbox } = this.events;
    if (!subscriptions || !outbox) {
      this.state.set('subscriptions', []);
      return;
    }
    subscriptions.sweepIfDue();
    await outbox.sweepIfDue();

    const { subscriptionId, occurrence } = this.input;
    if (subscriptionId === undefined) {
      this.state.set('subscriptions', await subscriptions.store.listByEvent(occurrence.name));
      return;
    }
    const targeted = await subscriptions.store.get(subscriptionId);
    this.state.set('subscriptions', targeted?.eventName === occurrence.name ? [targeted] : []);
  }

  /** Leave out suspended subscriptions, and end one without expiry that stayed suspended too long. */
  @Stage('dropInactive')
  async dropInactive() {
    const { suspendedTtlMs } = this.events.config.subscriptions;
    const now = Date.now();
    const active: EventSubscriptionRecord[] = [];
    for (const subscription of this.state.required.subscriptions) {
      if (subscription.active) {
        active.push(subscription);
        continue;
      }
      const suspendedFor = now - (subscription.status.suspendedSince ?? now);
      if (subscription.expiresAt === null && suspendedFor > suspendedTtlMs) {
        const codes = EVENT_DIALECTS[subscription.dialect].errorCodes;
        await this.terminate(subscription, {
          code: codes.callbackEndpointError,
          message: 'CallbackEndpointError',
          data: { reason: subscription.status.lastError ?? 'http_5xx' },
        });
      }
    }
    this.state.set('subscriptions', active);
  }

  /** Keep the subscriptions whose owner the publisher's `audience` names. */
  @Stage('filterByAudience')
  async filterByAudience() {
    const { audience } = this.input;
    const inAudience = this.state.required.subscriptions.filter((subscription) =>
      isInAudience(audience, subscription.subscriber),
    );
    this.state.set('subscriptions', inAudience);
  }

  /**
   * Check an owner whose last check is old against the event's `authorities`, then its `authorize()`, again. A refusal
   * ends the subscription; a check that could not be made neither delivers nor ends it, and is made again next time.
   */
  @Stage('reauthorize')
  async reauthorize() {
    const { event, context } = this.state.required;
    if (!hasReauthorization(this.scope, event, context.authorize !== undefined)) return;

    const { subscriptions } = this.events;
    const { reauthorizeEveryMs } = this.events.config.subscriptions;
    const now = Date.now();
    const allowed: EventSubscriptionRecord[] = [];
    for (const subscription of this.state.required.subscriptions) {
      if (now - subscription.lastAuthorizedAt <= reauthorizeEveryMs) {
        allowed.push(subscription);
        continue;
      }
      const { subscriber, arguments: subscriptionArguments } = subscription;
      const check = await reauthorizeSubscriber({
        scope: this.scope,
        event,
        subscriber,
        arguments: subscriptionArguments,
      });
      if (check.outcome === 'granted') {
        await subscriptions?.store.update(subscription.id, { lastAuthorizedAt: now });
        allowed.push(subscription);
        continue;
      }
      if (check.outcome === 'failed') {
        this.logger.warn(
          `reauthorize: the access of subscription ${subscription.id} could not be checked`,
          check.error,
        );
        continue;
      }
      await this.terminate(subscription, accessRevokedError(subscription.dialect));
    }
    this.state.set('subscriptions', allowed);
  }

  /** Ask the event's `match()` which subscriptions receive the event; one that throws is left out alone. */
  @Stage('match')
  async match() {
    const { context, subscriptions } = this.state.required;
    const { occurrence } = this.input;
    const deliveries: EventDeliveryPlan[] = [];
    for (const subscription of subscriptions) {
      try {
        const matches = (await context.match?.(occurrence, subscription.arguments, subscription.subscriber)) ?? true;
        if (matches) deliveries.push({ subscription, occurrence });
      } catch (error) {
        this.logger.warn(`match: event "${occurrence.name}" failed for subscription ${subscription.id}`, error);
      }
    }
    this.state.set('deliveries', deliveries);
  }

  /** Let the event's `transform()` shape the event for each subscription; one that throws is left out alone. */
  @Stage('transform')
  async transform() {
    const { context, deliveries } = this.state.required;
    if (!context.transform) return;
    const shaped: EventDeliveryPlan[] = [];
    for (const delivery of deliveries) {
      const { subscription, occurrence } = delivery;
      try {
        const transformed = await context.transform(occurrence, subscription.arguments, subscription.subscriber);
        shaped.push({ subscription, occurrence: EventOccurrenceSchema.parse(transformed) });
      } catch (error) {
        this.logger.warn(`transform: event "${occurrence.name}" failed for subscription ${subscription.id}`, error);
      }
    }
    this.state.set('deliveries', shaped);
  }

  /** Serialize each delivery once, and drop one whose body is over the limit: an event is never truncated. */
  @Stage('enforceBodyLimit')
  async enforceBodyLimit() {
    const fitting: EventDeliveryPlan[] = [];
    for (const delivery of this.state.required.deliveries) {
      const body = JSON.stringify(delivery.occurrence);
      const bytes = encoder.encode(body).byteLength;
      if (bytes <= EVENT_DELIVERY_MAX_BYTES) {
        fitting.push({ ...delivery, body });
        continue;
      }
      this.events.metrics?.count('dropped', delivery.occurrence.name);
      this.logger.warn(
        `enforceBodyLimit: event "${delivery.occurrence.name}" is ${bytes} bytes for subscription ` +
          `${delivery.subscription.id}, over the ${EVENT_DELIVERY_MAX_BYTES} byte limit; it is not delivered`,
      );
    }
    this.state.set('deliveries', fitting);
  }

  /** Hand one delivery per subscription to the outbox, with the `webhook-id` its dialect uses. */
  @Stage('enqueue')
  async enqueue() {
    const { outbox } = this.events;
    const { deliveries } = this.state.required;
    if (!outbox) return;
    const queued = deliveries.map(({ subscription, occurrence, body }) => {
      const usesEventId = EVENT_DIALECTS[subscription.dialect].webhookId === 'eventId';
      return outbox.enqueue({
        kind: 'event',
        subscriptionId: subscription.id,
        eventName: occurrence.name,
        body: body as string,
        webhookId: usesEventId ? occurrence.eventId : eventWebhookIdOf(subscription.id, occurrence.eventId),
      });
    });
    await Promise.all(queued);
    this.events.metrics?.count('matched', this.input.occurrence.name, deliveries.length);
  }

  /** Emit the occurrence once on the scope's event bus, under its name, for workflows and channels that listen to it. */
  @Stage('bridgeToBus')
  async bridgeToBus() {
    if (!this.events.config.bridge) return;
    const { occurrence } = this.input;
    this.scope.channelEventBus?.emit(occurrence.name, occurrence);
  }

  /** Answer with the event's id and how many deliveries were queued. */
  @Stage('buildResult')
  async buildResult() {
    this.respond({ eventId: this.input.occurrence.eventId, matched: this.state.required.deliveries.length });
  }

  /** End a subscription the server no longer serves: remove it, tell its event, and tell its callback when the dialect does. */
  private async terminate(subscription: EventSubscriptionRecord, error: EventTerminationError): Promise<void> {
    const { subscriptions, outbox, metrics } = this.events;
    await terminateEventSubscription({ subscriptions, outbox, metrics, logger: this.logger, subscription, error });
  }
}
