# Mail triage: a watcher per subscriber, a classifier, and mail for its owner only

Tells each user about the important mail of their own mailbox. When a user subscribes to `email.important`, the
event's `onSubscribe` starts a watcher of that user's mailbox on a (mocked) mail provider; each message is published
to that user alone. A plugin classifies each message as it is published and drops the unimportant ones.

| Piece                          | File                                                 |
| ------------------------------ | ---------------------------------------------------- |
| Server and auth                | `src/main.ts`                                        |
| `email.important`, the watcher | `src/apps/mail/events/email-important.event.ts`      |
| The mocked mail provider       | `src/apps/mail/mail-upstream.ts`                     |
| The classifier                 | `src/apps/mail/plugins/mail-classifier.plugin.ts`    |
| A tool that makes mail arrive  | `src/apps/mail/tools/simulate-incoming-mail.tool.ts` |
| Smoke test                     | `e2e/mail-triage.e2e.spec.ts`                        |

## What it shows

- **A per-user upstream, set up by the subscription.** `onSubscribe(args, subscription)` watches the mailbox of
  `subscription.subscriber.sub` and keeps the stop function by `subscription.id`; `onUnsubscribe` stops it, whether
  the client unsubscribed or the subscription expired. `onSubscribe` runs once per subscription, not on refreshes.
- **Mail for its owner only.** The watcher publishes with `audience: { sub: owner }`, so another user's subscription
  to the same event never receives it.
- **A classifier on `events:publish`.** `MailClassifierPlugin` hooks the `bufferOccurrence` stage of the publish
  flow and ends the publish (`ctx.respond({ eventId, matched: 0 })`) for an unimportant message: it is not delivered,
  not kept for `events/poll` and not streamed. Here a message is important when its subject says `urgent`,
  `outage`, `invoice` or `contract`, or it comes from `@board.example.com` or `@legal.example.com`; a real server
  would call its own classifier.
- **A minimal payload.** The event carries the message id, the sender and the subject, not the body. The client reads
  the rest with a tool, under the user's own authorization. Subjects are written by strangers: a client must treat
  them as untrusted text.

## Run it

```bash
IDP_PROVIDER_URL=https://your-idp.example.com npx tsx apps/e2e/demo-e2e-events-mail-triage/src/main.ts
```

The server listens on `PORT` (3180). Replace `mail-upstream.ts` with your provider's push API, and remove the
`simulate_incoming_mail` tool, which exists for the demo.

Watchers and subscriptions are kept in memory: after a restart, a client's next `events/subscribe` creates the
subscription again, which starts its watcher again.

## Test it

```bash
npx nx test demo-e2e-events-mail-triage
```
