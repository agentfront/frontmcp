import { internalZ as z } from '@frontmcp/lazy-zod';
import { SubscribeEventRequestSchema, SubscribeEventResultSchema, type AuthInfo } from '@frontmcp/protocol';
import { isStandardWebhookSecret, validateOutboundUrl, type OutboundUrlProblem } from '@frontmcp/utils';

import { EventEntry, Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { callSurfaceOf, isOfferedOnSurface } from '../../common/availability';
import {
  EventCallbackEndpointError,
  EventForbiddenError,
  EventNotFoundError,
  EventProtocolError,
  EventResourceExhaustedError,
  EventUnsupportedError,
  InvalidInputError,
  isPublicError,
  type EventErrorCodes,
} from '../../errors';
import { callerPlatformOf, EVENT_DIALECTS, resolveEventDialect } from '../event-dialect';
import { eventSubscriberOf, type EventSubscriberIdentity } from '../event-subscriber';
import type EventRegistry from '../event.registry';
import { type EventSubscriptionRecord, type EventSubscriptionStatus } from '../subscription/event-subscription.store';
import { deliveryStatusOf, type EventSubscriptions } from '../subscription/event-subscriptions';

const inputSchema = z.object({
  request: SubscribeEventRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = SubscribeEventResultSchema;

const stateSchema = z.object({
  authInfo: z.any() as z.ZodType<Partial<AuthInfo>>,
  dialect: z.enum(['sep-3415', 'sketch']),
  event: z.instanceof(EventEntry),
  owner: z.any() as z.ZodType<EventSubscriberIdentity>,
  arguments: z.record(z.string(), z.unknown()),
  subscriptionId: z.string(),
  argumentsKey: z.string(),
  existing: z.any() as z.ZodType<EventSubscriptionRecord | undefined>,
  verifiedAt: z.number(),
  expiresAt: z.number().nullable(),
  record: z.any() as z.ZodType<EventSubscriptionRecord>,
});

const plan = {
  pre: [
    'parseInput',
    'resolveDialect',
    'findEvent',
    'checkAvailability',
    'requireWebhookMode',
    'requireSubscriber',
    'checkEntryAuthorities',
    'validateArguments',
    'authorize',
    'validateDelivery',
  ],
  execute: [
    'findSubscription',
    'enforceLimits',
    'verifyCallback',
    'grantTtl',
    'upsertSubscription',
    'notifySubscribed',
  ],
  post: ['buildResult'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:subscribe': FlowRunOptions<
      EventSubscribeFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:subscribe' as const;
const { Stage } = FlowHooksOf<'events:subscribe'>(name);

const URL_PROBLEMS: Record<OutboundUrlProblem, string> = {
  malformed: 'it is not a URL',
  scheme: 'it must use https',
  credentials: 'it must not carry a user name or a password',
  host: 'its host is local, private or a metadata service',
};

/** The status a refresh keeps: the last delivery and the last failure, without the count that suspended it. */
function reactivatedStatus(status: EventSubscriptionStatus = {}): EventSubscriptionStatus {
  const { failures: _failures, suspendedSince: _suspendedSince, ...kept } = status;
  return kept;
}

/** `events/subscribe`: create or refresh the caller's webhook subscription to one event. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class EventSubscribeFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventSubscribeFlow');

  /** The event registry of a scope that serves webhook subscriptions. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** The subscriptions of the scope; the flow is registered only when it has them. */
  private get subscriptions(): EventSubscriptions {
    return this.events.subscriptions as EventSubscriptions;
  }

  /** The JSON-RPC codes of the caller's dialect. */
  private get codes(): EventErrorCodes {
    return EVENT_DIALECTS[this.state.required.dialect].errorCodes;
  }

  /** Read the caller's auth from the request context. */
  @Stage('parseInput')
  async parseInput() {
    const authInfo = (this.input.ctx as { authInfo?: Partial<AuthInfo> } | undefined)?.authInfo ?? {};
    this.state.set('authInfo', authInfo);
  }

  /** Pick the dialect every error and the stored subscription are answered in. */
  @Stage('resolveDialect')
  async resolveDialect() {
    const platform = callerPlatformOf(this.scope, this.state.required.authInfo, this.tryGetContext()?.platformType);
    this.state.set('dialect', resolveEventDialect(this.events.config.compat, platform));
  }

  /** Find the event the request names. */
  @Stage('findEvent')
  async findEvent() {
    const eventName = this.input.request.params.name;
    const event = this.events.findByName(eventName);
    if (!event) throw new EventNotFoundError(this.codes, 'event', eventName);
    this.state.set('event', event);
  }

  /** An event `availableWhen.surface` keeps from the caller's surface is answered as an unknown one. */
  @Stage('checkAvailability')
  async checkAvailability() {
    const { event } = this.state.required;
    if (!isOfferedOnSurface(event.metadata.availableWhen, callSurfaceOf(this.input.ctx))) {
      throw new EventNotFoundError(this.codes, 'event', event.name);
    }
  }

  /** Refuse a delivery mode other than webhook, and an event that is not offered by webhook. */
  @Stage('requireWebhookMode')
  async requireWebhookMode() {
    const requestedMode = this.input.request.params.delivery.mode ?? 'webhook';
    const subscribableModes = this.events
      .deliveryModesOf(this.state.required.event)
      .filter((mode) => mode === 'webhook');
    if (requestedMode !== 'webhook' || subscribableModes.length === 0) {
      throw new EventUnsupportedError(this.codes, 'deliveryMode', requestedMode, subscribableModes);
    }
  }

  /** A webhook subscription has an owner: an anonymous caller cannot create one. */
  @Stage('requireSubscriber')
  async requireSubscriber() {
    const { authInfo, event } = this.state.required;
    const owner = eventSubscriberOf(authInfo, this.scope.authoritiesContextBuilder);
    if (!owner)
      throw new EventForbiddenError(this.codes, event.name, 'a webhook subscription needs a signed-in caller');
    this.state.set('owner', owner);
  }

  /** Evaluate the event's `authorities` with the subscription arguments as input. */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    const engine = this.scope.authoritiesEngine;
    const contextBuilder = this.scope.authoritiesContextBuilder;
    const { event, authInfo } = this.state.required;
    const authorities = event.getAuthorities();
    if (!engine || !contextBuilder || !authorities) return;

    const evaluationContext = contextBuilder.build(authInfo as never, this.input.request.params.arguments ?? {});
    const result = await engine.evaluate(authorities, evaluationContext);
    if (!result.granted) {
      throw new EventForbiddenError(this.codes, event.name, result.deniedBy ?? 'policy denied');
    }
  }

  /** Parse the arguments with the event's input schema. */
  @Stage('validateArguments')
  async validateArguments() {
    try {
      this.state.set('arguments', this.state.required.event.parseArguments(this.input.request.params.arguments ?? {}));
    } catch (error) {
      throw new InvalidInputError(
        'Invalid subscription arguments',
        error instanceof z.ZodError ? error.issues : undefined,
      );
    }
  }

  /** Run the event's own `authorize()`: whatever it throws refuses the subscription. */
  @Stage('authorize')
  async authorize() {
    const { event, authInfo, owner } = this.state.required;
    try {
      await event.create(authInfo).authorize?.(this.state.required.arguments, owner.subscriber);
    } catch (error) {
      if (error instanceof EventProtocolError) throw error;
      const reason = isPublicError(error) ? error.getPublicMessage() : 'the event refused it';
      throw new EventForbiddenError(this.codes, event.name, reason);
    }
  }

  /** Refuse a callback URL the server must not call and a secret that is not a Standard Webhooks one. */
  @Stage('validateDelivery')
  async validateDelivery() {
    const { url, secret } = this.input.request.params.delivery;
    const allowLocal = this.events.config.webhook.unsafeAllowLocalCallbacks;
    const urlCheck = validateOutboundUrl(url, { allowLocal });
    if (!urlCheck.ok) throw new InvalidInputError(`Invalid delivery.url: ${URL_PROBLEMS[urlCheck.problem]}`);
    if (!isStandardWebhookSecret(secret)) {
      throw new InvalidInputError(
        'Invalid delivery.secret: expected "whsec_" followed by base64 that decodes to 24 to 64 bytes',
      );
    }
  }

  /** Derive the subscription's id and load the one stored under it, ending it first when its lifetime is over. */
  @Stage('findSubscription')
  async findSubscription() {
    const { owner, event } = this.state.required;
    const { url } = this.input.request.params.delivery;
    const identity = this.subscriptions.identityOf(owner.principalKey, url, event.name, this.state.required.arguments);
    this.subscriptions.sweepIfDue();

    const existing = await this.subscriptions.store.get(identity.id);
    if (!existing) await this.subscriptions.expire(identity.id);
    this.state.set({ subscriptionId: identity.id, argumentsKey: identity.argumentsKey, existing });
  }

  /** A new subscription counts against the caller's limit; a refresh does not. */
  @Stage('enforceLimits')
  async enforceLimits() {
    if (this.state.existing) return;
    const { maxPerPrincipal } = this.subscriptions.settings;
    const held = await this.subscriptions.store.countByPrincipal(this.state.required.owner.principalKey);
    if (held >= maxPerPrincipal) throw new EventResourceExhaustedError(this.codes, 'subscriptions', maxPerPrincipal);
  }

  /** Prove the callback accepts deliveries before the subscription is stored. */
  @Stage('verifyCallback')
  async verifyCallback() {
    const { url, secret } = this.input.request.params.delivery;
    const { owner, subscriptionId } = this.state.required;
    const verification = await this.subscriptions.verifier.verify({
      principalKey: owner.principalKey,
      url,
      secret,
      subscriptionId,
      verifiedAt: this.state.existing?.verifiedAt,
    });
    if (verification.outcome === 'limited') {
      throw new EventResourceExhaustedError(this.codes, 'verifications', verification.max);
    }
    if (verification.outcome === 'failed') {
      this.logger.verbose(`verifyCallback: subscription ${subscriptionId} refused (${verification.reason})`);
      throw new EventCallbackEndpointError(this.codes, verification.reason);
    }
    this.state.set('verifiedAt', verification.verifiedAt);
  }

  /** Decide when the subscription ends. */
  @Stage('grantTtl')
  async grantTtl() {
    const requestedTtlMs = this.input.request.params.ttlMs;
    this.state.set('expiresAt', this.subscriptions.grantExpiry(this.state.required.event, requestedTtlMs, Date.now()));
  }

  /** Store the subscription; a refresh replaces the secret, the owner snapshot and the lifetime, and reactivates it. */
  @Stage('upsertSubscription')
  async upsertSubscription() {
    const { url, secret } = this.input.request.params.delivery;
    const { owner, event, dialect, subscriptionId, argumentsKey, verifiedAt, expiresAt } = this.state.required;
    const existing = this.state.existing;
    const now = Date.now();
    const record: EventSubscriptionRecord = {
      id: subscriptionId,
      principalKey: owner.principalKey,
      subscriber: owner.subscriber,
      eventName: event.name,
      arguments: this.state.required.arguments,
      argumentsKey,
      delivery: this.subscriptions.rotatedDelivery(existing?.delivery, url, secret, now),
      dialect,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt,
      verifiedAt,
      lastAuthorizedAt: now,
      active: true,
      status: reactivatedStatus(existing?.status),
    };
    await this.subscriptions.store.upsert(record);
    this.state.set('record', record);
  }

  /** Call `onSubscribe` for a new subscription only; when it throws, the subscription is taken back. */
  @Stage('notifySubscribed')
  async notifySubscribed() {
    if (this.state.existing) return;
    const { event, record, authInfo } = this.state.required;
    try {
      await this.subscriptions.notifySubscribed(event, record, authInfo);
    } catch (error) {
      await this.subscriptions.store.delete(record.id);
      throw error;
    }
    this.logger.verbose(`notifySubscribed: subscription ${record.id} created for event "${event.name}"`);
  }

  /** Answer with the id, the granted lifetime and, on a refresh, the delivery status. */
  @Stage('buildResult')
  async buildResult() {
    const { record } = this.state.required;
    this.respond({
      id: record.id,
      refreshBefore: record.expiresAt === null ? null : new Date(record.expiresAt).toISOString(),
      cursor: null,
      truncated: false,
      ...(this.state.existing && { deliveryStatus: deliveryStatusOf(record) }),
    });
  }

  /** Runs after a success or a failure, so hooks that must see both attach here. */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize');
  }
}
