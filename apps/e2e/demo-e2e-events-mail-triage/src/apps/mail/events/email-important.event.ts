import { z } from '@frontmcp/lazy-zod';
import { event, type EventSubscriptionRef } from '@frontmcp/sdk';

import { mailUpstream } from '../mail-upstream';

/** The watcher of a mailbox and how many open subscriptions of its owner share it. */
interface MailboxWatch {
  stop: () => void;
  subscriptions: number;
}

/** One watcher per mailbox, kept while any subscription of its owner is open. */
const mailboxWatches = new Map<string, MailboxWatch>();

/**
 * Important mail of the subscriber's own mailbox. A subscription starts a watcher of that mailbox; each message is
 * published to the mailbox's owner only, and the classifier plugin drops the unimportant ones.
 */
export const emailImportant = event({
  name: 'email.important',
  description: 'An important email arrived in your mailbox',
  payloadSchema: { messageId: z.string(), from: z.string(), subject: z.string() },

  /** Watch the mailbox of the subscriber, once for all their subscriptions; publish each message to them alone. */
  onSubscribe(_args, subscription: EventSubscriptionRef) {
    const owner = subscription.subscriber.sub;
    const watching = mailboxWatches.get(owner);
    if (watching) {
      watching.subscriptions += 1;
      return;
    }
    const events = this.events;
    const logger = this.scope.logger;
    const stop = mailUpstream.watch(owner, (mail) => {
      const data = { messageId: mail.id, from: mail.from, subject: mail.subject };
      events
        .publish(emailImportant, data, { audience: { sub: owner } })
        .catch((error: unknown) => logger.warn(`Mail ${mail.id} was not published`, error));
    });
    mailboxWatches.set(owner, { stop, subscriptions: 1 });
  },

  /** Stop watching the mailbox when the last subscription of its owner ended. */
  onUnsubscribe(_args, subscription: EventSubscriptionRef) {
    const owner = subscription.subscriber.sub;
    const watching = mailboxWatches.get(owner);
    if (!watching) return;
    watching.subscriptions -= 1;
    if (watching.subscriptions > 0) return;
    watching.stop();
    mailboxWatches.delete(owner);
  },
});
