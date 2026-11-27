import { internalZ as z } from '@frontmcp/lazy-zod';

import {
  Flow,
  FlowBase,
  FlowHooksOf,
  type EventSubscriptionRef,
  type EventUnsubscribeReason,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { type EventTerminationError } from '../subscription/event-subscription-termination';
import { type EventSubscriptionRecord } from '../subscription/event-subscription.store';
import { subscriptionRefOf } from '../subscription/event-subscriptions';

const reasonSchema = z.enum([
  'unsubscribed',
  'expired',
  'closed',
  'terminated',
]) satisfies z.ZodType<EventUnsubscribeReason>;

const inputSchema = z.object({
  record: z.any() as z.ZodType<EventSubscriptionRecord>,
  reason: reasonSchema,
  termination: (z.any() as z.ZodType<EventTerminationError>).optional(),
});

const outputSchema = z.object({});

const stateSchema = z.object({
  /** The subscription as it was stored when it was removed. */
  record: z.any() as z.ZodType<EventSubscriptionRecord>,
  /** The subscription as the event's `onUnsubscribe` got it: `{ id, name, mode, subscriber }`. */
  subscription: z.any() as z.ZodType<EventSubscriptionRef>,
  reason: reasonSchema,
  /** For `'terminated'`: the error its callback is told, access revoked or a callback that kept failing. */
  termination: z.any() as z.ZodType<EventTerminationError | undefined>,
});

const plan = {
  pre: ['parseInput'],
  execute: ['notifyEnded'],
  post: ['buildResult'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:ended': FlowRunOptions<
      EventEndedFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:ended' as const;
const { Stage } = FlowHooksOf<'events:ended'>(name);

/**
 * `events:ended`: a webhook subscription ended, however it ended: the client unsubscribed, its lifetime ran out, or the
 * server terminated it. It runs once per subscription across every process, after the event's `onUnsubscribe`, so
 * hooks on it see every end in one place. What a hook throws is logged; the subscription stays ended.
 */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
})
export default class EventEndedFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventEndedFlow');

  /** Put the ended subscription and why it ended in the state, for the hooks. */
  @Stage('parseInput')
  async parseInput() {
    const { record, reason, termination } = this.input;
    this.state.set({ record, subscription: subscriptionRefOf(record), reason, ...(termination && { termination }) });
  }

  /** The stage hooks attach to: the subscription is removed and its event was told. */
  @Stage('notifyEnded')
  async notifyEnded() {
    const { record, reason } = this.state.required;
    this.logger.verbose(`notifyEnded: subscription ${record.id} to event "${record.eventName}" ended (${reason})`);
  }

  /** Answer with an empty result. */
  @Stage('buildResult')
  async buildResult() {
    this.respond({});
  }

  /** Runs after a success or a failure, so hooks that must see both attach here. */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize');
  }
}
