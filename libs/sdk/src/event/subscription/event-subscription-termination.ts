import { generateWebhookMessageId } from '@frontmcp/utils';

import { type FrontMcpLogger } from '../../common';
import { type EventMetrics } from '../delivery/event-metrics';
import { type EventOutbox } from '../delivery/event-outbox';
import { EVENT_DIALECTS, type EventDialect } from '../event-dialect';
import { type EventSubscriptionRecord } from './event-subscription.store';
import { type EventSubscriptions } from './event-subscriptions';

/** The error a terminated subscription's callback is told, in the `terminated` envelope. */
export interface EventTerminationError {
  code: number;
  message: string;
  data: Record<string, unknown>;
}

export interface TerminateEventSubscriptionArgs {
  subscriptions: EventSubscriptions | undefined;
  outbox: Pick<EventOutbox, 'enqueue'> | undefined;
  metrics: EventMetrics | undefined;
  logger: FrontMcpLogger;
  subscription: EventSubscriptionRecord;
  error: EventTerminationError;
}

/** The error of a subscription whose owner was refused when checked again, in the codes of its dialect. */
export function accessRevokedError(dialect: EventDialect): EventTerminationError {
  return {
    code: EVENT_DIALECTS[dialect].errorCodes.forbidden,
    message: 'Forbidden',
    data: { reason: 'Access revoked' },
  };
}

/** End a subscription the server no longer serves: remove it, tell its event, and tell its callback when the dialect does. */
export async function terminateEventSubscription(args: TerminateEventSubscriptionArgs): Promise<void> {
  const { subscriptions, outbox, metrics, logger, subscription, error } = args;
  const removed = await subscriptions?.store.delete(subscription.id);
  if (!removed || !subscriptions || !outbox) return;
  await subscriptions.notifyUnsubscribed(removed, 'terminated');
  metrics?.count('terminated', removed.eventName);
  logger.warn(
    `Subscription ${removed.id} to event "${removed.eventName}" is terminated: ${error.message} ` +
      `(${String(error.data['reason'])})`,
  );
  if (!EVENT_DIALECTS[removed.dialect].sendsControlEnvelopes) return;
  const { url, secret, previousSecret, previousSecretUntil } = removed.delivery;
  await outbox.enqueue({
    kind: 'terminated',
    subscriptionId: removed.id,
    eventName: removed.eventName,
    body: JSON.stringify({ type: 'terminated', error }),
    webhookId: generateWebhookMessageId('terminated'),
    target: { url, secret, previousSecret, previousSecretUntil },
  });
}
