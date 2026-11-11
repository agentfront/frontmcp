import { z } from '@frontmcp/lazy-zod';
import { event, type EventSubscriptionRef } from '@frontmcp/sdk';

import { mailUpstream } from '../mail-upstream';

/** The watcher each subscription started, so the subscription's end stops it. */
const stopWatching = new Map<string, () => void>();

/**
 * Important mail of the subscriber's own mailbox. A subscription starts a watcher of that mailbox; each message is
 * published to the mailbox's owner only, and the classifier plugin drops the unimportant ones.
 */
export const emailImportant = event({
  name: 'email.important',
  description: 'An important email arrived in your mailbox',
  payloadSchema: { messageId: z.string(), from: z.string(), subject: z.string() },

  /** Watch the mailbox of the subscriber; publish each message to them alone. */
  onSubscribe(_args, subscription: EventSubscriptionRef) {
    const owner = subscription.subscriber.sub;
    const events = this.events;
    const logger = this.scope.logger;
    const stop = mailUpstream.watch(owner, (mail) => {
      const data = { messageId: mail.id, from: mail.from, subject: mail.subject };
      events
        .publish(emailImportant, data, { audience: { sub: owner } })
        .catch((error: unknown) => logger.warn(`Mail ${mail.id} was not published`, error));
    });
    stopWatching.set(subscription.id, stop);
  },

  /** Stop the watcher of the subscription that ended. */
  onUnsubscribe(_args, subscription: EventSubscriptionRef) {
    stopWatching.get(subscription.id)?.();
    stopWatching.delete(subscription.id);
  },
});
