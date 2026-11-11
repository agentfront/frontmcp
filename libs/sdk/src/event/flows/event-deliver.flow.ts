import { internalZ as z } from '@frontmcp/lazy-zod';
import { EventDeliveryErrorCategorySchema, MCP_SUBSCRIPTION_ID_HEADER } from '@frontmcp/protocol';
import {
  outboundFailureCategory,
  sendOutboundRequest,
  signingKeyOf,
  webhookSignatureHeaders,
  type OutboundResult,
} from '@frontmcp/utils';

import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import {
  type EventDeliveryOutcome,
  type EventDeliveryRecord,
  type EventDeliveryTarget,
} from '../delivery/event-outbox';
import { eventOutboundTargetOptions } from '../event-outbound';
import type EventRegistry from '../event.registry';
import { type EventSubscriptionRecord, type EventSubscriptionStatus } from '../subscription/event-subscription.store';
import { type EventSubscriptions } from '../subscription/event-subscriptions';

const inputSchema = z.object({
  delivery: z.any() as z.ZodType<EventDeliveryRecord>,
});

const outputSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('delivered') }),
  z.object({ result: z.literal('dropped'), reason: z.enum(['gone', 'refused']) }),
  z.object({ result: z.literal('failed'), category: EventDeliveryErrorCategorySchema }),
  z.object({ result: z.literal('waiting') }),
]);

const stateSchema = z.object({
  target: z.any() as z.ZodType<EventDeliveryTarget>,
  subscription: z.any() as z.ZodType<EventSubscriptionRecord | undefined>,
  headers: z.record(z.string(), z.string()),
  answer: z.any() as z.ZodType<OutboundResult>,
  outcome: z.any() as z.ZodType<EventDeliveryOutcome>,
});

const plan = {
  pre: ['loadSubscription', 'buildHeaders'],
  execute: ['send', 'classify'],
  post: ['buildResult'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:deliver': FlowRunOptions<
      EventDeliverFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:deliver' as const;
const { Stage } = FlowHooksOf<'events:deliver'>(name);

/** Failed attempts in a row after which a subscription is suspended until its next `events/subscribe`. */
export const SUSPEND_AFTER_FAILURES = 20;
const GONE = 410;
const PAYLOAD_TOO_LARGE = 413;

/** `events:deliver`: one attempt of one delivery, signed and sent to the subscription's callback. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'public',
})
export default class EventDeliverFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('EventDeliverFlow');

  /** The event registry of a scope that delivers by webhook. */
  private get events(): EventRegistry {
    return this.scope.events as EventRegistry;
  }

  /** The subscriptions of the scope; the flow is registered only when it has them. */
  private get subscriptions(): EventSubscriptions {
    return this.events.subscriptions as EventSubscriptions;
  }

  /** Find where the delivery goes: its subscription, or the target a `terminated` envelope carries; else nothing is sent. */
  @Stage('loadSubscription')
  async loadSubscription() {
    const { delivery } = this.input;
    if (delivery.target) {
      this.state.set('target', delivery.target);
      return;
    }
    const subscription = await this.subscriptions.store.get(delivery.subscriptionId);
    if (!subscription) {
      this.state.set('outcome', { result: 'dropped', reason: 'gone' });
      return;
    }
    if (!subscription.active) {
      this.state.set('outcome', { result: 'waiting' });
      return;
    }
    this.state.set({ subscription, target: subscription.delivery });
  }

  /** Sign the stored body for this attempt: the same `webhook-id`, a fresh timestamp, every secret in use. */
  @Stage('buildHeaders')
  async buildHeaders() {
    if (this.state.outcome) return;
    const { delivery } = this.input;
    const { secret, previousSecret, previousSecretUntil } = this.state.required.target;
    const now = Date.now();
    const signingKeys = [signingKeyOf(secret)];
    if (previousSecret !== undefined && (previousSecretUntil ?? 0) > now) {
      signingKeys.push(signingKeyOf(previousSecret));
    }
    const message = { id: delivery.webhookId, timestamp: Math.floor(now / 1000), body: delivery.body };
    this.state.set('headers', {
      'content-type': 'application/json',
      [MCP_SUBSCRIPTION_ID_HEADER]: delivery.subscriptionId,
      ...webhookSignatureHeaders(message, signingKeys),
    });
  }

  /** POST the stored body, unchanged, through the hardened request. */
  @Stage('send')
  async send() {
    if (this.state.outcome) return;
    const { webhook } = this.events.config;
    const answer = await sendOutboundRequest({
      url: this.state.required.target.url,
      method: 'POST',
      headers: this.state.required.headers,
      body: this.input.delivery.body,
      timeoutMs: webhook.delivery.timeoutMs,
      ...eventOutboundTargetOptions(webhook.unsafeAllowLocalCallbacks),
    });
    this.state.set('answer', answer);
  }

  /** Decide what the answer means, and record it on the subscription. */
  @Stage('classify')
  async classify() {
    if (this.state.outcome) return;
    const { answer } = this.state.required;
    const category = outboundFailureCategory(answer);
    if (!category) {
      await this.recordStatus(() => ({ status: { lastDeliveryAt: Date.now() } }));
      this.state.set('outcome', { result: 'delivered' });
      return;
    }
    if (answer.answered && (answer.status === GONE || answer.status === PAYLOAD_TOO_LARGE)) {
      await this.recordStatus((status) => ({ status: { ...status, lastError: category } }));
      this.state.set('outcome', { result: 'dropped', reason: 'refused' });
      return;
    }
    await this.recordFailure(category);
    this.state.set('outcome', { result: 'failed', category });
  }

  /** Answer with the outcome of the attempt. */
  @Stage('buildResult')
  async buildResult() {
    this.respond(this.state.required.outcome);
  }

  /** Count a failed attempt, and suspend the subscription once too many failed in a row. */
  private async recordFailure(category: NonNullable<EventSubscriptionStatus['lastError']>): Promise<void> {
    const now = Date.now();
    const updated = await this.recordStatus((status, active) => {
      const failures = (status.failures ?? 0) + 1;
      const failing = { ...status, lastError: category, failedSince: status.failedSince ?? now, failures };
      const suspendsNow = active && failures >= SUSPEND_AFTER_FAILURES;
      return suspendsNow ? { active: false, status: { ...failing, suspendedSince: now } } : { status: failing };
    });
    if (updated && !updated.active && updated.status.suspendedSince === now) {
      this.events.metrics?.count('suspended', updated.eventName);
      this.logger.warn(
        `Subscription ${updated.id} to event "${updated.eventName}" is suspended after ${SUSPEND_AFTER_FAILURES} ` +
          `failed deliveries in a row (${category}). Its next events/subscribe reactivates it.`,
      );
    }
  }

  /** Change the status of the delivery's subscription; a `terminated` envelope has none to change. */
  private async recordStatus(
    change: (status: EventSubscriptionStatus, active: boolean) => { active?: boolean; status: EventSubscriptionStatus },
  ): Promise<EventSubscriptionRecord | undefined> {
    const { subscription } = this.state;
    if (!subscription) return undefined;
    return this.subscriptions.store.update(subscription.id, (current) => change(current.status, current.active));
  }
}
