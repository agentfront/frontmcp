---
name: mail-triage-per-user-watcher
reference: create-event
level: advanced
description: 'Important mail for its owner only: a watcher per subscriber started in onSubscribe, and a classifier hook on events:publish that drops the rest.'
tags: [development, event, onSubscribe, plugin, hooks, audience]
features:
  - 'Starting a per-user upstream watcher in `onSubscribe` and stopping it in `onUnsubscribe`'
  - 'Publishing from the watcher with `audience: { sub }` so only the mailbox owner receives it'
  - 'A plugin hook on `events:publish` that ends the publish for an unimportant message'
---

# Mail Triage: a Watcher per Subscriber and a Classifier

Important mail for its owner only: a watcher per subscriber started in onSubscribe, and a classifier hook on events:publish that drops the rest.

Tells each user about the important mail of their own mailbox. The runnable app, with a mocked mail provider and a
smoke test, is `apps/e2e/demo-e2e-events-mail-triage` in the FrontMCP repository.

## Code

```typescript
// src/apps/mail/events/email-important.event.ts
import { event, z, type EventSubscriptionRef } from '@frontmcp/sdk';

import { mailUpstream } from '../mail-upstream';

const stopWatching = new Map<string, () => void>();

export const emailImportant = event({
  name: 'email.important',
  description: 'An important email arrived in your mailbox',
  payloadSchema: { messageId: z.string(), from: z.string(), subject: z.string() },

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

  onUnsubscribe(_args, subscription: EventSubscriptionRef) {
    stopWatching.get(subscription.id)?.();
    stopWatching.delete(subscription.id);
  },
});
```

```typescript
// src/apps/mail/plugins/mail-classifier.plugin.ts
import { EventPublishHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

const IMPORTANT_SUBJECT = /\b(urgent|outage|invoice|contract)\b/i;
const IMPORTANT_SENDERS = /@(board|legal)\.example\.com$/i;

export function isImportant(mail: { from: string; subject: string }): boolean {
  return IMPORTANT_SUBJECT.test(mail.subject) || IMPORTANT_SENDERS.test(mail.from);
}

@Plugin({ name: 'mail-classifier', description: 'Drops the unimportant mail before it is published' })
export default class MailClassifierPlugin {
  @EventPublishHook.Will('bufferOccurrence')
  dropUnimportantMail(ctx: FlowCtxOf<'events:publish'>) {
    const { occurrence } = ctx.rawInput;
    if (occurrence.name !== 'email.important') return;
    const mail = occurrence.data as { from: string; subject: string };
    if (!isImportant(mail)) ctx.respond({ eventId: occurrence.eventId, matched: 0 });
  }
}
```

```typescript
// src/apps/mail/index.ts
@App({ name: 'mail', events: [emailImportant], tools: [SimulateIncomingMailTool], plugins: [MailClassifierPlugin] })
export class MailApp {}
```

## What This Demonstrates

- Starting a per-user upstream watcher in `onSubscribe` and stopping it in `onUnsubscribe`
- Publishing from the watcher with `audience: { sub }` so only the mailbox owner receives it
- A plugin hook on `events:publish` that ends the publish for an unimportant message

## Notes

- `onSubscribe` runs once per new subscription (not on a refresh) and `onUnsubscribe` when it ends, unsubscribed or
  expired: the place to start and stop what an upstream needs per subscriber.
- `audience: { sub: owner }` keeps one user's mail away from every other subscription of the same event.
- Ending the publish flow at `bufferOccurrence` with `ctx.respond(...)` drops the event for every mode: no webhook
  delivery, nothing kept for `events/poll`, nothing streamed.
- The payload is the message id, the sender and the subject; the client reads the body with a tool. Subjects come from
  strangers: treat them as untrusted text.

## Related

- See `create-event` for lifecycle methods and the publish flow, `create-plugin-hooks` for flow hooks
