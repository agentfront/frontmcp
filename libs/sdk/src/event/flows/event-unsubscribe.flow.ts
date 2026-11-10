import { internalZ as z } from '@frontmcp/lazy-zod';
import { UnsubscribeEventRequestSchema, UnsubscribeEventResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { EventForbiddenError } from '../../errors';
import { callerPlatformOf, EVENT_DIALECTS, resolveEventDialect } from '../event-dialect';
import { eventSubscriberOf, type EventSubscriberIdentity } from '../event-subscriber';
import type EventRegistry from '../event.registry';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const inputSchema = z.object({
  request: UnsubscribeEventRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = UnsubscribeEventResultSchema;

const stateSchema = z.object({
  authInfo: z.any() as z.ZodType<Partial<AuthInfo>>,
  dialect: z.enum(['sep-3415', 'sketch']),
  owner: z.any() as z.ZodType<EventSubscriberIdentity>,
});

const plan = {
  pre: ['parseInput', 'resolveDialect', 'requireSubscriber'],
  execute: ['removeSubscription'],
  post: ['buildResult'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:unsubscribe': FlowRunOptions<
      EventUnsubscribeFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:unsubscribe' as const;
const { Stage } = FlowHooksOf<'events:unsubscribe'>(name);

/** `events/unsubscribe`: remove the caller's subscription. Removing one that does not exist succeeds too. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class EventUnsubscribeFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventUnsubscribeFlow');

  /** The event registry of a scope that serves webhook subscriptions. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** The subscriptions of the scope; the flow is registered only when it has them. */
  private get subscriptions(): EventSubscriptions {
    return this.events.subscriptions as EventSubscriptions;
  }

  /** Read the caller's auth from the request context. */
  @Stage('parseInput')
  async parseInput() {
    const authInfo = (this.input.ctx as { authInfo?: Partial<AuthInfo> } | undefined)?.authInfo ?? {};
    this.state.set('authInfo', authInfo);
  }

  /** Pick the dialect a refusal is answered in. */
  @Stage('resolveDialect')
  async resolveDialect() {
    const platform = callerPlatformOf(this.scope, this.state.required.authInfo, this.tryGetContext()?.platformType);
    this.state.set('dialect', resolveEventDialect(this.events.config.compat, platform));
  }

  /** Only its owner can name a subscription, so an anonymous caller has none to remove. */
  @Stage('requireSubscriber')
  async requireSubscriber() {
    const { authInfo, dialect } = this.state.required;
    const owner = eventSubscriberOf(authInfo, this.scope.authoritiesContextBuilder);
    if (!owner) {
      const eventName = this.input.request.params.name;
      const codes = EVENT_DIALECTS[dialect].errorCodes;
      throw new EventForbiddenError(codes, eventName, 'a webhook subscription needs a signed-in caller');
    }
    this.state.set('owner', owner);
  }

  /** Remove the subscription the caller's key names and tell its event, once. */
  @Stage('removeSubscription')
  async removeSubscription() {
    const { name: eventName, delivery } = this.input.request.params;
    const { owner, authInfo } = this.state.required;
    const identity = this.subscriptions.identityOf(owner.principalKey, delivery.url, eventName, this.storedArguments());
    this.subscriptions.sweepIfDue();

    const removed = await this.subscriptions.store.delete(identity.id);
    if (!removed) return;
    await this.subscriptions.notifyUnsubscribed(removed, 'unsubscribed', authInfo);
    this.logger.verbose(`removeSubscription: subscription ${removed.id} removed from event "${eventName}"`);
  }

  /** Answer with an empty result, whether or not a subscription was removed. */
  @Stage('buildResult')
  async buildResult() {
    this.respond({});
  }

  /** Runs after a success or a failure, so hooks that must see both attach here. */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize');
  }

  /** The arguments as `events/subscribe` stored them: parsed by the event's schema, or as sent when that fails. */
  private storedArguments(): Record<string, unknown> {
    const { name: eventName, arguments: sentArguments = {} } = this.input.request.params;
    try {
      return this.events.findByName(eventName)?.parseArguments(sentArguments) ?? sentArguments;
    } catch {
      return sentArguments;
    }
  }
}
