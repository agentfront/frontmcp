---
name: create-event
description: Declare the event types clients list with events/list and subscribe to (MCP Events, SEP-3415) with @Event or event(), with a name, argument and payload schemas, authorities and delivery modes
---

# Events: What Clients Can Subscribe To

An event is a named kind of thing that happens in your system: an order is placed, an incident opens, a comment is
added. A client lists the server's event types with `events/list`, subscribes to one with arguments, and receives its
occurrences when no user is connected. This is MCP Events, the `io.modelcontextprotocol/events` extension (SEP-3415),
which ChatGPT reads from the top-level `events` capability.

This reference covers declaring events, what `events/list` answers, how a client subscribes by webhook with
`events/subscribe`, reads with `events/poll` or holds a stream with `events/stream`, and how the server publishes an
event and delivers it. An event is listed once the server performs a delivery mode the event allows (see
[Delivery Modes](#delivery-modes)).

## When to Use This Skill

### Must Use

- A client such as ChatGPT or an agent runtime should react to something that happens in your system without a user
  asking for it
- You declare what clients may watch: the event's name, the arguments of a subscription, and the shape of its payload

### Recommended

- You already notify people or other systems about something (a webhook, a queue message) and want agents to get it too

### Skip When

- A Claude Code session that is connected now should get a message: use a channel (see `frontmcp-channels`)
- The client starts the work and waits for its result: use a tool, or a job for long work (see `create-job`)
- The server does recurring work on its own: use a duty (see `create-duty`)

> **Decision:** Use `@Event` for something a client subscribes to once and is told about each time it happens.

## Steps

### Step 1: Declare the event

```typescript
import { Event, EventContext, z } from '@frontmcp/sdk';

@Event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  inputSchema: { status: z.string().optional().describe('Only orders in this status') },
  payloadSchema: { orderId: z.string(), status: z.string(), total: z.number() },
})
export class OrderCreated extends EventContext {}
```

The class must extend `EventContext`. It needs no methods: an event without them is delivered, as published, to every
subscription of its name.

### Step 2: Or declare it with `event()`

```typescript
import { event, z } from '@frontmcp/sdk';

export const orderShipped = event({
  name: 'order.shipped',
  payloadSchema: { orderId: z.string(), carrier: z.string() },
});
```

`event()` takes the same options as `@Event`, and infers the types of an event's arguments and payload from its schemas.

### Step 3: Register it in `events`

```typescript
@App({ name: 'orders', events: [OrderCreated, orderShipped] })
class OrdersApp {}
```

Declaring an event turns events on. Each event runs with the providers of the app that declares it (`this.get()`), as
that app's tools do. An app that declares events cannot be a lazy app.

### Step 4: Check what clients see

`events/list` answers one definition per event. On a server whose auth signs callers in, an event is offered by
poll and by webhook; on a server in public auth mode, by poll only (see [Delivery Modes](#delivery-modes)):

```json
{
  "events": [
    {
      "name": "order.created",
      "description": "Fires when an order is placed",
      "delivery": ["poll", "webhook"],
      "inputSchema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": { "status": { "type": "string", "description": "Only orders in this status" } }
      },
      "payloadSchema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "orderId": { "type": "string" },
          "status": { "type": "string" },
          "total": { "type": "number" }
        },
        "required": ["orderId", "status", "total"],
        "additionalProperties": false
      }
    }
  ]
}
```

A schema converted from Zod names its JSON Schema dialect in `$schema`. The input schema of an event that declares no
`inputSchema` is written by hand and has no `$schema` (see Schemas).

## `@Event` Options

| Field                | Type                            | Default                        | Notes                                                                                   |
| -------------------- | ------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| `name`               | `string`                        | Required                       | Unique in the server. 1 to 128 characters, no whitespace or control characters          |
| `description?`       | `string`                        | None                           | Tells the client's model what the event means and when it fires                         |
| `inputSchema?`       | Zod raw shape or `z.object()`   | No arguments                   | The arguments of a subscription: filters and options                                    |
| `payloadSchema`      | Zod raw shape or `z.object()`   | Required                       | The `data` of each occurrence                                                           |
| `delivery?`          | `('poll'\|'push'\|'webhook')[]` | Every mode the server performs | Restricts the event to these modes. At least one                                        |
| `authorities?`       | Profile name, names, or policy  | Open to every caller           | Who may list the event and subscribe to it (see `frontmcp-authorities`)                 |
| `tags?`              | `string[]`                      | None                           | For your own grouping, read with `entry.getTags()`                                      |
| `hideFromDiscovery?` | `boolean`                       | `false`                        | Leaves the event out of `events/list`. A client that knows the name can still subscribe |
| `availableWhen?`     | `EntryAvailability`             | Always                         | Where the event exists: `runtime`, `platform`, `deployment`, `env`, `surface`           |
| `ttl?`               | `{ defaultMs?, maxMs? }`        | The server's                   | Subscription lifetime bounds for this event. `defaultMs` must not exceed `maxMs`        |

An invalid option throws `InvalidDecoratorMetadataError` (`INVALID_DECORATOR_METADATA`) when the class is decorated or
`event()` is called, naming the field: `@Event invalid metadata for "name": An event name must not contain whitespace
or control characters`.

## Names

A subscription names its event, so each event of a server needs its own name. Two events with one name fail startup
with `EventNameConflictError` (`EVENT_NAME_CONFLICT`): `Event "order.created" is declared twice: each event of a server
needs its own name. Rename one of them with @Event({ name }).` The same class or function listed by two apps is one
event, not a conflict.

Keep a name for as long as clients may hold subscriptions to it. For a change that breaks the payload or the
arguments, declare a new name and serve both for a while.

## Schemas

- `inputSchema` and `payloadSchema` take a Zod raw shape (`{ orderId: z.string() }`) or a `z.object()`. Subscription
  arguments and event payloads are objects, so any other schema is refused.
- Clients get both as JSON Schema, `inputSchema` converted the way `tools/list` converts a tool's:
  `entry.getInputJsonSchema()` and `entry.getPayloadJsonSchema()`.
- An event without `inputSchema` takes no arguments. Its input JSON Schema is
  `{ "type": "object", "properties": {}, "additionalProperties": false }`.
- Add optional fields over time. Do not remove, rename or retype a field of a name clients already subscribe to.
- Keep payloads small: what a client needs to decide what to do, with an id it can pass to a tool for the rest.

## Delivery Modes

MCP Events has three delivery modes: `webhook` (the server POSTs each event to a callback URL), `poll` and `push`. An
event is offered in the modes the server performs, within the event's own `delivery` when it sets one
(`scope.events.deliveryModesOf(entry)`).

| Server performs           | Event's `delivery` | Offered in                     |
| ------------------------- | ------------------ | ------------------------------ |
| `poll`, `push`, `webhook` | Not set            | `poll`, `push`, `webhook`      |
| `poll`, `push`, `webhook` | `['poll']`         | `poll`                         |
| `poll`, `push`            | `['webhook']`      | Not served: no mode is left    |
| None                      | Any                | No event is served (see below) |

A server that performs no delivery mode serves no events: it does not advertise the capability, and `events/list`
answers `-32601` (Method not found), as on a server without events. Declared events are still registered and checked
at startup.

The server performs `poll` unless `events.poll.enabled` is `false`, on every runtime and in every auth mode (see
[Polling](#polling)).

The server performs `webhook` when its auth signs callers in (any `auth.mode` other than `public`) and
`events.webhook.enabled` is not `false`. A subscription belongs to a caller, so in public mode the server logs
`Webhook event delivery is off: the server runs in public auth mode, so a subscription would have no owner.` and
offers its events by poll and push only.

The server performs `push` unless `events.push.enabled` is `false`, except in a serverless deployment (see
[Streaming](#streaming)).

## Who Sees an Event

`events/list` answers per caller:

- **`authorities`**: an event the caller's roles, permissions or policy do not allow is left out, as a guarded tool is
  left out of `tools/list`. An event whose policy throws is left out, and the others are still listed. The server
  refuses to start when an event declares `authorities` and `@FrontMcp({ authorities })` is not set, or when a rule
  checks nothing: `Authorities configuration required: Event "payroll.run" declare 'authorities' metadata ...`.
- **`hideFromDiscovery: true`**: the event is never listed.
- **`availableWhen`**: an event the process excludes (`runtime`, `platform`, `deployment`, `env`) is not registered at
  all, so another event may use its name there. `surface` is checked per request: `surface: ['agent']` hides the event
  from MCP clients.

### Over a subscription's life

A subscription is checked when it is created and again while it lives, not only when the event is listed. When a
publish reaches a subscription whose last check is older than `subscriptions.reauthorizeEveryMs` (5 minutes), the
server checks its stored owner (the `subscriber` of the last `events/subscribe`) with its stored arguments:

1. The event's `authorities`, with the arguments as the rule's input.
2. Then the event's `authorize(args, subscriber)`, on a context created for that owner: `this.authInfo` holds the
   owner's claims, `sub`, `iss` and scopes, and no token.

The first that does not allow the owner decides:

- **A refusal** ends the subscription: the rule denies, or `authorize()` throws a public error (an
  `EventForbiddenError`, or any `PublicMcpError`). The subscription is removed, the event's `onUnsubscribe` runs with
  the reason `'terminated'`, and a SEP-3415 subscription's callback gets a `terminated` envelope with the reason
  `Access revoked`.
- **A check that could not be made** keeps the subscription: the rule's evaluation throws, or `authorize()` throws any
  other error (an upstream that is down, a timeout). The event is not delivered to it this time, the server logs
  `reauthorize: the access of subscription <id> could not be checked`, and the next publish checks it again.

An open `events/stream` is checked the same way, with the reader as it was when the stream opened and the request's
arguments, at the first heartbeat after `subscriptions.reauthorizeEveryMs`:

- A refusal ends it with `notifications/events/terminated` and the reason `Access revoked`.
- A check that could not be made keeps it open: the server logs `The access of stream <id> could not be checked`, the
  stream sends heartbeats but no events, and checks again at the next heartbeat. Once a check allows the reader,
  events flow again, after an `active` with `truncated: true` when published events were held back meanwhile. A
  stream of an event with `check()` does not call it while its access is unchecked.

This is the split `events/subscribe` makes: it passes on what a public error says as the `reason`, and answers any
other error with `the event refused it`. When subscribing, both refuse, since there is no subscription to keep yet.
Throw an `EventForbiddenError` (or a `PublicMcpError`) from `authorize()` for "no", and let an upstream failure throw
as it is.

## `events/list`

- Events are ordered by name.
- Answers come in pages of 40. A page that is not the last has a `nextCursor`, which the client sends back as `cursor`.
  A `cursor` of `null`, or none, asks for the first page. A cursor is base64-encoded JSON with an `offset`: one that
  does not decode, whose offset is not a non-negative integer, or whose offset is past the end of the caller's list is
  refused as invalid input. The server does not check that it issued the cursor.
- Under protocol 2026-07-28 the result has `resultType: "complete"`. It carries no cache hints.
- The request runs the hookable `events:list` flow, with the stages `parseInput`, `findEvents`,
  `filterByAvailability`, `filterByAuthorities`, `filterByDiscovery`, `parseEvents` and `finalize`, which runs after
  a success or a failure. Hook it with `ListEventsHook`:

```typescript
import { ListEventsHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

@Plugin({ name: 'beta-events' })
class BetaEventsPlugin {
  @ListEventsHook.Did('findEvents')
  hideBetaEvents(ctx: FlowCtxOf<'events:list'>) {
    const stable = ctx.state.required.events.filter(({ event }) => !event.getTags().includes('beta'));
    ctx.state.set('events', stable);
  }
}
```

With `@frontmcp/observability`, each `events/list` request is traced as an `events/list` span.

## Subscriptions

A client subscribes to one event with `events/subscribe`, naming a callback URL and the secret deliveries are signed
with:

```json
{
  "method": "events/subscribe",
  "params": {
    "name": "order.created",
    "arguments": { "status": "paid" },
    "delivery": { "mode": "webhook", "url": "https://hooks.example.com/mcp", "secret": "whsec_<base64>" },
    "ttlMs": 3600000
  }
}
```

```json
{ "id": "sub_3f2a…", "refreshBefore": "2026-10-02T12:00:00.000Z", "cursor": null, "truncated": false }
```

- `delivery.mode` may be left out; `webhook` is the only mode `events/subscribe` takes.
- `cursor` and `maxAgeMs` are accepted and ignored: the answer's `cursor` is `null`.
- Under protocol 2026-07-28 the client sends the event name in the `Mcp-Name` header, and the result has
  `resultType: "complete"`.

### Identity and refresh

A subscription is identified by its owner, its callback URL, the event name and its arguments: the `id` is `sub_` and
32 hex characters derived from them, never taken from the request. The owner is the signed-in caller,
`principal:<iss>#<sub>` (`principal:<sub>` when the token names no issuer). Arguments are compared after the event's
`inputSchema` parsed them and in canonical JSON, so another key order is the same subscription.

Subscribing again with the same identity refreshes the subscription instead of creating a second one. A refresh:

- grants the lifetime again and answers the new `refreshBefore`
- replaces the secret; when it differs, the replaced one stays on the subscription for
  `events.webhook.rotationGraceMs` (5 minutes)
- replaces the stored owner (`subscriber`: roles, permissions, scopes, claims, tenant) with the caller as it is now
- sets the subscription active again
- adds `deliveryStatus` to the answer: `{ active, lastDeliveryAt, lastError, failedSince }`

### What is checked

In this order. The first check that fails answers the request:

| Check                                                                                  | Error                   | `data`                                              |
| -------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| The event exists and is offered on the caller's surface                                | `NotFound`              | `{ kind: 'event', name }`                           |
| The mode is `webhook` and the event is offered by webhook                              | `Unsupported`           | `{ feature: 'deliveryMode', value, supported }`     |
| The caller is signed in (not anonymous)                                                | `Forbidden`             | `{ reason }`                                        |
| The event's `authorities` allow the caller, with the arguments as the rule's input     | `Forbidden`             | `{ reason }`                                        |
| The arguments match `inputSchema`                                                      | Invalid params          | `-32602`                                            |
| The event's `authorize(args, subscriber)` does not throw                               | `Forbidden`             | `{ reason }`                                        |
| The URL is `https`, has no credentials, and its host is not local, private or metadata | Invalid params          | `-32602`                                            |
| The secret is `whsec_` and base64 that decodes to 24 to 64 bytes                       | Invalid params          | `-32602`                                            |
| A new subscription keeps the caller within `subscriptions.maxPerPrincipal`             | `ResourceExhausted`     | `{ limit: 'subscriptions', max }`                   |
| The callback host got fewer than 10 verification attempts in the last minute           | `ResourceExhausted`     | `{ limit: 'verifications', max: 10 }`               |
| The callback proves it accepts deliveries (see below)                                  | `CallbackEndpointError` | `{ reason }`, a category such as `challenge_failed` |

When `authorize()` throws a `PublicMcpError`, its message is the `reason` the client reads. Any other error is
answered as `the event refused it`.

Each error has two JSON-RPC codes. A caller detected as OpenAI (ChatGPT) gets the design-sketch code, every other
caller the SEP-3415 one, unless `events.compat` pins a dialect:

| Error                   | SEP-3415 | Design sketch |
| ----------------------- | -------- | ------------- |
| `NotFound`              | `-32023` | `-32011`      |
| `Forbidden`             | `-32024` | `-32012`      |
| `ResourceExhausted`     | `-32025` | `-32013`      |
| `Unsupported`           | `-32026` | `-32014`      |
| `CallbackEndpointError` | `-32027` | `-32015`      |

The classes are exported from `@frontmcp/sdk`: `EventNotFoundError`, `EventForbiddenError`,
`EventResourceExhaustedError`, `EventUnsupportedError`, `EventCallbackEndpointError`.

### Callback verification

Before a subscription is stored, its callback must prove it accepts MCP deliveries. The first of these that holds is
enough:

1. The URL starts with one of `events.webhook.allowedCallbacks`.
2. The same caller verified the same URL less than `events.webhook.verification.cacheTtlMs` (1 hour) ago.
3. The callback's origin serves `/.well-known/mcp-webhook-receiver.json` with `{ "receivers": ["/hooks/"] }`, and the
   callback's path starts with one of those prefixes. The document is read once per origin every 5 minutes.
4. The callback answers a challenge: the server POSTs `{ "type": "verification", "challenge": "<nonce>" }`, signed
   with the subscription's secret (`webhook-id: msg_verification_…`, `webhook-timestamp`, `webhook-signature`,
   `X-MCP-Subscription-Id`), and the callback must answer `2xx` with `{ "challenge": "<nonce>" }`.

A failed verification answers `CallbackEndpointError` with a category only: `challenge_failed`, `timeout`,
`connection_refused`, `tls_error`, `http_4xx` or `http_5xx`. The callback is contacted with the same protection as a
delivery: `https` only, a public address, no redirects.

### Lifetime

| `ttlMs` in the request | Granted                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| Left out               | `subscriptions.defaultTtlMs` (1 hour), or the event's `ttl.defaultMs`             |
| A number               | That many milliseconds, between `minTtlMs` (1 minute) and `maxTtlMs` (24 hours)   |
| `null`                 | No expiry (`refreshBefore: null`) when allowed (see below); otherwise the maximum |

An event's `ttl.maxMs` lowers the maximum for that event, never raises it. No expiry is granted only with
`subscriptions.allowNoExpiry: true`, a store that outlives the process (`events.store`), and an event without
`ttl.maxMs`.

A subscription whose lifetime is over is no longer returned, and its event's `onUnsubscribe(args, subscription,
'expired')` is called once. A long-lived process looks for expired subscriptions every 60 seconds. On serverless and
edge runtimes the look happens on an `events/subscribe` or `events/unsubscribe` request, at most once a minute.

### Unsubscribing

`events/unsubscribe` takes the same `name`, `arguments` and `delivery.url`, and answers `{}`. It answers `{}` as well
when no such subscription exists, so a client can repeat it. An anonymous caller is answered `Forbidden`.

### What the event is told

- `onSubscribe(args, subscription)` runs once, when a subscription is created, never on a refresh. When it throws, the
  subscription is removed and the client gets the error.
- `onUnsubscribe(args, subscription, reason)` runs once when it ends, with `'unsubscribed'` or `'expired'`. When it
  throws, the error is logged.
- `subscription` is `{ id, name, mode, subscriber }`.

### Where subscriptions are kept

In memory by default: they end with the process. With `events.store.sqlite: { path }` or `events.store.redis` they
are kept, and shared by every process of the server. A kept store holds webhook secrets, so it needs a secret to
encrypt them with: `MCP_EVENTS_SECRET`, else `MCP_SESSION_SECRET`, else `MCP_SERVER_SECRET`. Without one the server
refuses to start. Vercel KV is refused: it has no atomic compare-and-set.

`scope.events.subscriptions` is the server's `EventSubscriptions`, with its `store` (`get`, `listByEvent`,
`countByPrincipal`, `update`, `delete`).

### Hooks

Both requests run hookable flows. `events:subscribe` (`EventSubscribeHook`) has the stages `parseInput`,
`resolveDialect`, `findEvent`, `checkAvailability`, `requireWebhookMode`, `requireSubscriber`,
`checkEntryAuthorities`, `validateArguments`, `authorize`, `validateDelivery`, `findSubscription`, `enforceLimits`,
`verifyCallback`, `grantTtl`, `upsertSubscription`, `notifySubscribed`, `buildResult` and `finalize`.
`events:unsubscribe` (`EventUnsubscribeHook`) has `parseInput`, `resolveDialect`, `requireSubscriber`,
`removeSubscription`, `buildResult` and `finalize`. `finalize` runs after a success or a failure: attach a
`Finally` hook there for work that must see refused requests too.

```typescript
import { EventSubscribeHook, Plugin, PublicMcpError, type FlowCtxOf } from '@frontmcp/sdk';

@Plugin({ name: 'callback-policy' })
class CallbackPolicyPlugin {
  @EventSubscribeHook.Will('verifyCallback')
  refuseForeignCallbacks(ctx: FlowCtxOf<'events:subscribe'>) {
    const { url } = ctx.rawInput.request.params.delivery;
    if (!url.startsWith('https://hooks.example.com/')) throw new PublicMcpError('callback host is not ours');
  }
}
```

With `@frontmcp/observability`, the two requests are traced as `events/subscribe` and `events/unsubscribe` spans.

## Publishing

Publish an occurrence from any context (a tool, a job, an agent, a channel, a route) with `this.events`:

```typescript
import { Tool, ToolContext, z } from '@frontmcp/sdk';

@Tool({ name: 'place_order', inputSchema: { orderId: z.string(), total: z.number() } })
class PlaceOrderTool extends ToolContext {
  async execute({ orderId, total }: { orderId: string; total: number }) {
    const { eventId, matched } = await this.events.publish(OrderCreated, { orderId, status: 'paid', total });
    return { orderId, eventId, matched };
  }
}
```

- The first argument is the `@Event` class, what `event()` returned, or the event's name. With the class or the
  function, `data` has the type of `payloadSchema`.
- `data` is validated against `payloadSchema` before anything is sent.
- The result is `{ eventId, matched }`: `matched` is how many subscriptions a delivery was queued for. In a
  long-lived process deliveries happen after `publish()` returned. On a serverless, edge or browser runtime the first
  attempt of each delivery is made before `publish()` resolves (all of them at once, within `delivery.concurrency`),
  so `publish()` can take as long as the slowest callback, up to `webhook.delivery.timeoutMs`.
- Outside a context, use `scope.events.publisher`. In a provider, a duty or a worker, inject it with the
  `EVENT_PUBLISHER` token: `this.get(EVENT_PUBLISHER)`.
- `matched` counts webhook deliveries. A client that polls is not counted: it reads the occurrence at its next poll.
  On a server that performs no webhook mode, `publish()` answers `matched: 0`.
- A service that does not link the SDK publishes with an HTTP request: see
  [Publishing over HTTP](#publishing-over-http).

| Option            | Type                                          | Default                         | Notes                                                       |
| ----------------- | --------------------------------------------- | ------------------------------- | ----------------------------------------------------------- |
| `eventId?`        | `string`                                      | `evt_` and 24 random characters | Pass the upstream id to let receivers deduplicate on it     |
| `timestamp?`      | `string \| Date`                              | Now                             | When it happened. Delivered as ISO 8601 in UTC              |
| `subscriptionId?` | `string`                                      | Every subscription of the event | Deliver to this one subscription only                       |
| `audience?`       | `{ sub?, tenantId?, roles?: { any?, all? } }` | Every owner                     | Narrows by the OWNER of each subscription, before `match()` |

`audience.sub` and `audience.tenantId` take one value or several. `roles.any` needs one of the roles, `roles.all`
every one. They are compared with the owner as stored on the subscription, which each `events/subscribe` replaces.

Mistakes of the server author are thrown, not delivered:

| Error                      | Message                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `EventNotRegisteredError`  | ``Event "<name>" is not registered, so it cannot be published. List it in the `events` of an app.`` |
| `InvalidEventPublishError` | `Event "<name>" cannot be published: its data does not match payloadSchema: ...`                    |
| `EventsNotEnabledError`    | `Events are not enabled on this server, so nothing can be published. ...`                           |

### Which subscriptions receive it

`publish()` runs the hookable `events:publish` flow (`EventPublishHook`), with the stages `validate`,
`loadSubscriptions`, `dropInactive`, `filterByAudience`, `reauthorize`, `match`, `transform`, `enforceBodyLimit`,
`enqueue` and `buildResult`:

1. Suspended subscriptions are left out.
2. `audience` narrows by owner.
3. For an event with `authorities` or `authorize()`, an owner whose last check is older than
   `subscriptions.reauthorizeEveryMs` (5 minutes) is checked again, the rule first, then `authorize()` (see
   [Over a subscription's life](#over-a-subscriptions-life)). An owner refused loses the subscription: it is removed,
   `onUnsubscribe(args, subscription, 'terminated')` runs, and a SEP-3415 subscription's callback gets a `terminated`
   envelope. When the check could not be made, the event is not delivered to that subscription this time and the
   subscription is kept.
4. `match(event, args, subscriber)` decides per subscription. Without it, every subscription receives the event.
5. `transform(event, args, subscriber)` returns the event as that subscription receives it: an occurrence with
   `eventId`, `name`, `timestamp` and `data`.
6. A delivery whose JSON body is over 262144 bytes is dropped for that subscription and logged. It is never truncated.

A `match()` or a `transform()` that throws for one subscription is logged, and that subscription alone is left out.

```typescript
export const orderCreated = event({
  name: 'order.created',
  inputSchema: { status: z.string().optional() },
  payloadSchema: { orderId: z.string(), status: z.string(), total: z.number() },
  match(occurrence, args) {
    return args.status === undefined || args.status === occurrence.data.status;
  },
});
```

## Publishing over HTTP

Another service (a backend, a queue consumer, a cron container) publishes an event with one `POST`, without linking
the SDK. The endpoint is off until `events.publishEndpoint.enabled` is `true`:

```typescript
@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [OrdersApp],
  events: { publishEndpoint: { enabled: true, secret: process.env['EVENTS_PUBLISH_SECRET'] } },
})
class ShopServer {}
```

```bash
body='{"name":"order.created","data":{"orderId":"o-1","status":"paid","total":42}}'
timestamp=$(date +%s)
signature=$(printf '%s.%s' "$timestamp" "$body" | openssl dgst -sha256 -hmac "$EVENTS_PUBLISH_SECRET" -r | cut -d' ' -f1)
curl -X POST https://mcp.example.com/events/publish \
  -H 'Content-Type: application/json' \
  -H "X-FrontMCP-Timestamp: $timestamp" \
  -H "X-FrontMCP-Signature: v1=$signature" \
  --data-binary "$body"
```

The answer is `202` with what `publish()` returns: `{ "eventId": "evt_…", "matched": 1 }`. The request goes through the
same `EventPublisher.publish()` as `this.events.publish()`, so the `events:publish` flow and its hooks run for it.

| Body field        | Type                                          | Notes                                                              |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `name`            | `string`                                      | Required. The name of a registered event                           |
| `data`            | `object`                                      | Required. Validated against the event's `payloadSchema`            |
| `eventId?`        | `string`                                      | 1 to 255 visible ASCII characters, no space. See Repeated requests |
| `timestamp?`      | `string`                                      | A date `new Date()` reads, such as `2026-10-02T12:00:00Z`          |
| `audience?`       | `{ sub?, tenantId?, roles?: { any?, all? } }` | As the `audience` option of `publish()`                            |
| `subscriptionId?` | `string`                                      | As the `subscriptionId` option of `publish()`                      |

A key the endpoint does not know is refused with `400`, in the body, in `audience` and in `audience.roles`: a
misspelled `audience` never turns into a publish to everyone.

The path is `events.publishEndpoint.path` (`/events/publish`), at the root of the server, not under the MCP entry
path. On a `splitByApp` server each app serves its own endpoint under its route base (`/billing/events/publish`), for
the events of that app. The endpoint answers `POST` only.

### Who may publish

`events.publishEndpoint.secret` decides which of two ways the endpoint knows its callers:

- **With `secret`** (at least 32 characters): every request is signed with it, exactly as a request to a workflow
  webhook is (see `create-workflow`). `X-FrontMCP-Timestamp` is the time of signing in Unix seconds.
  `X-FrontMCP-Signature` is `v1=` and the hex HMAC-SHA256, keyed with the secret, of the timestamp, a `.`, and the
  body's bytes exactly as sent. The server refuses a timestamp more than 5 minutes from its clock, either way, and a
  signature it already accepted: to send a request again, sign it again. It remembers accepted signatures in its own
  process.
- **Without `secret`**: the caller presents the bearer credentials of the MCP endpoint in the `Authorization` header,
  which the same `session:verify` flow verifies. An anonymous caller is refused, also on a server whose auth lets
  anonymous callers in. With `events.publishEndpoint.authorities`, the caller must satisfy that rule too. It is
  evaluated with the request body as the rule's input, so a rule can read `input.name`.

Without `secret` and without `authorities`, every signed-in caller may publish every event, to any `audience`. The
server logs a warning at startup: `POST /events/publish lets every signed-in caller publish every event. ...`. Set
`authorities` unless every signed-in caller is trusted to publish. This rule lets a caller publish only the event its
token names in the `publishes` claim:

```typescript
events: {
  publishEndpoint: {
    enabled: true,
    authorities: { attributes: { conditions: [{ path: 'input.name', op: 'eq', value: { fromClaims: 'publishes' } }] } },
  },
},
```

The server refuses to start when the endpoint could not tell who publishes, or cannot listen on its path. The first,
fifth and sixth of these are an `EventPublishEndpointError` (`EVENT_PUBLISH_ENDPOINT`), the second and third are
refused when `@FrontMcp` validates its options, and the fourth is an `AuthConfigurationError`:

| Configuration                                                                                          | Message                                                                                              |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `enabled: true`, no `secret`, and `auth.mode` is `public`                                              | `Event publish endpoint: the server runs in public auth mode, so nothing tells who publishes. ...`   |
| `secret` shorter than 32 characters                                                                    | `events.publishEndpoint.secret must be at least 32 characters (make one with: openssl rand -hex 32)` |
| `secret` together with `authorities`                                                                   | `events.publishEndpoint takes secret or authorities, not both: a signed request names no caller ...` |
| `authorities` without `@FrontMcp({ authorities })`                                                     | `Authorities configuration required: events.publishEndpoint declare 'authorities' metadata ...`      |
| `path` is the MCP endpoint, `/health`, `/metrics`, a health probe, or under `/oauth` or `/.well-known` | `... path "/healthz" is on the reserved FrontMCP path "/healthz": choose another path`               |
| `path` is one an `@HttpRoute` or an `http.routes` entry answers for `POST`                             | `... path "/hooks" is already served by the route POST /hooks: choose another path`                  |

### What the endpoint answers

The request runs the hookable `events:publish-http` flow (`EventPublishHttpHook`), with the stages `checkIpFilter`,
`acquireQuota`, `readBody`, `authenticate`, `parseBody`, `checkAuthorities`, `findEvent`, `validatePayload`,
`claimEventId`, `publish`, `rememberResult`, `buildResponse` and `finalize`. `finalize` runs for every request,
however it ended. The first check that fails answers:

| Status | Body                                                                                       | When                                                                                         |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `403`  | The answer of `throttle.ipFilter`                                                          | The caller's address is denied                                                               |
| `429`  | The answer of `throttle.global`                                                            | The server's global rate limit is used up                                                    |
| `415`  | `{ error: 'The body must be application/json' }`                                           | The `Content-Type` is not `application/json`                                                 |
| `413`  | `{ error: 'Payload too large' }`                                                           | The body is over 262144 bytes (256 KiB), what one delivery may carry                         |
| `401`  | `{ error: 'Unauthorized' }`                                                                | With `secret`: unsigned, malformed, outside the 5 minutes, a wrong signature, or sent before |
| `401`  | `{ error: 'Unauthorized' }`, and `WWW-Authenticate` when the server has a challenge        | Without `secret`: no token, or one the server cannot verify                                  |
| `401`  | `{ error: 'Unauthorized', message: 'Publishing needs a signed-in caller' }`                | Without `secret`: an anonymous caller                                                        |
| `403`  | `{ error: 'Forbidden' }`, and `WWW-Authenticate`                                           | Without `secret`: the token lacks the scopes `auth.requiredScopes` asks for                  |
| `400`  | `{ error: 'Invalid publish request', issues: [{ path, message }] }`                        | The body is not a JSON object of the fields above                                            |
| `403`  | `{ error: 'Forbidden' }`                                                                   | `events.publishEndpoint.authorities` refuses the caller                                      |
| `404`  | `{ error: 'Event "<name>" is not registered' }`                                            | The server has no event of that name                                                         |
| `422`  | `{ error: 'data does not match the payloadSchema of event "<name>"', issues: [...] }`      | `data` does not match `payloadSchema`                                                        |
| `409`  | `{ error: 'Event "<name>" with eventId "<id>" is being published; retry for its answer' }` | Another request with the same `eventId` is publishing right now                              |
| `202`  | `{ eventId, matched }`                                                                     | Published, or already published with this `eventId` (see below)                              |

`issues` name where a problem is (`path`, such as `total` or `audience`) and what it is (`message`). They never
repeat a value of the request. With a `secret`, every refusal is the same `401`, and the server's log says which
check refused it: `authenticate: a publish request was refused: expired`. The Node server's JSON parser answers a body
that is not JSON with its own `400`, before the endpoint runs.

### Repeated requests

A request that names an `eventId` is idempotent for 10 minutes, per event name: a repeat within them is answered `202`
with the answer of the first request, and nothing is published again. The repeat is checked like any request first
(its caller, its body, its `data`). A sender that retries after a timeout therefore sends the same `eventId`, and
signs the retry again.

- The answers are kept in the events store (`events.store`), so with `redis` or `sqlite` every process of the server
  sees them. In memory they belong to one process.
- A publish that fails gives its `eventId` back: the retry publishes.
- When the store cannot keep the answer of a publish that succeeded, the request still answers `202` and the server
  logs a warning. A repeat within 60 seconds is then answered `409`, and a repeat after that publishes again.
- While the first request is still publishing, a repeat is answered `409`. A request that never finished (the
  process died) stops blocking its `eventId` after 60 seconds.
- A request without an `eventId` gets a generated one and is never deduplicated.

### Hooking the endpoint

```typescript
import { EventPublishHttpHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

@Plugin({ name: 'publish-audit' })
class PublishAuditPlugin {
  @EventPublishHttpHook.Did('findEvent')
  recordPublisher(ctx: FlowCtxOf<'events:publish-http'>) {
    const { publication, caller } = ctx.state;
    console.log(`${caller?.user?.sub ?? 'a signed request'} publishes ${publication?.name}`);
  }
}
```

`ctx.state.caller` is the bearer caller's auth info, and is not set for a signed request. With
`@frontmcp/observability`, each request is traced as an `events/publish-http` span.

## Delivery

Each delivery is one POST to the subscription's callback. The body is the occurrence:

```json
{
  "eventId": "evt_Zk3…",
  "name": "order.created",
  "timestamp": "2026-10-02T12:00:00.000Z",
  "data": { "orderId": "o-1", "status": "paid", "total": 42 }
}
```

| Header                  | Value                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `webhook-id`            | The same on every attempt of one delivery (see below)                                           |
| `webhook-timestamp`     | The Unix time of this attempt, in seconds                                                       |
| `webhook-signature`     | `v1,<base64>` over `<id>.<timestamp>.<body>`; two, separated by a space, while a secret rotates |
| `X-MCP-Subscription-Id` | The subscription's `id`                                                                         |
| `Content-Type`          | `application/json`                                                                              |

The body is serialized once: the same bytes are signed and sent on every attempt. The `webhook-id` depends on the
dialect the subscription was created in: a message id of its own (`msg_…`) under SEP-3415, the `eventId` under the
design sketch (ChatGPT).

### What a response means

| Response                                               | What the server does                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `2xx`                                                  | The delivery is done. The receiver has taken the event |
| `410` or `413`                                         | The delivery is dropped. It is never retried           |
| Any other status, a redirect, a timeout, no connection | The attempt failed. The delivery is retried            |

Delivery is at least once: a receiver can get the same delivery twice, so it deduplicates on `webhook-id`, and a tool
it calls in response should be safe to call twice. Events can arrive out of order.

### Retries

A delivery is attempted up to `webhook.delivery.maxAttempts` (5) times within `retryWindowMs` (15 minutes) of its
first attempt. The wait before the next attempt starts at `backoffMs` (1 second), doubles with each attempt up to
`maxBackoffMs` (60 seconds), and is shortened by a random part of up to half. A delivery that used its attempts or
its window is abandoned, and logged:
`Delivery dlv_… of event "order.created" to subscription sub_… is abandoned after 5 attempt(s): http_5xx`.

Each attempt has `timeoutMs` (10 seconds), follows no redirect, and connects only to a public address over `https`.
At most `concurrency` (16) deliveries are in flight in one process.

### Suspension

After 20 failed attempts in a row, a subscription is suspended: `deliveryStatus.active` is `false`, and its pending
deliveries wait, looking again every 30 seconds until their retry window ends. The next `events/subscribe` for the
same subscription reactivates it. An acknowledged delivery ends the count.

A subscription without expiry that stayed suspended for longer than `subscriptions.suspendedTtlMs` (7 days) is ended
the next time its event is published: `onUnsubscribe(..., 'terminated')` runs, and a SEP-3415 subscription's callback
gets a `terminated` envelope.

### The `terminated` envelope

A body with a top-level `type` is not an event. When the server ends a SEP-3415 subscription, it sends, signed like a
delivery and with `webhook-id: msg_terminated_…`:

```json
{ "type": "terminated", "error": { "code": -32024, "message": "Forbidden", "data": { "reason": "Access revoked" } } }
```

Subscriptions of the design-sketch dialect get no envelope.

### Pending deliveries

A pending delivery is a record in the same store as the subscriptions, removed when it is done, dropped or abandoned.

- **Memory** (the default): pending deliveries end with the process.
- **`events.store.sqlite` or `events.store.redis`**: they survive a restart. The process that queued a delivery holds
  it; when that process stops it releases what it holds, and when it dies another process takes the delivery over
  once its lease ran out (the attempt's time, plus `timeoutMs`, plus 30 seconds). Every process looks for such
  deliveries when it starts and every 30 seconds.
- **Serverless and edge runtimes** start no timers: the first attempt is made before `publish()` returns, and a
  retry runs during a later `publish()`, at most one look every 30 seconds.

`scope.events.outbox` is the server's `EventOutbox` (`depth()`, `sweep()`).

### Hooks, metrics and health

- One attempt runs the hookable `events:deliver` flow (`EventDeliverHook`): `loadSubscription`, `buildHeaders`,
  `send`, `classify`, `buildResult`.
- With `@frontmcp/observability`, publishing and each attempt are traced as `events/publish` and `events/deliver`
  spans.
- With `metrics: { enabled: true }`, `/metrics` has these counters, labelled `event`:
  `frontmcp_events_published_total`, `frontmcp_events_matched_total`, `frontmcp_events_delivered_total`,
  `frontmcp_events_retried_total`, `frontmcp_events_abandoned_total`, `frontmcp_events_dropped_total`,
  `frontmcp_events_suspended_total`, `frontmcp_events_terminated_total`.
- `/readyz` has an `events-outbox` check. Its details show `pendingDeliveries`, and it is unhealthy when the store
  does not answer.

### What to put in a payload

- The least a receiver needs: ids and a few fields to decide what to do. The receiver reads the rest with a tool,
  under its own authorization.
- No secrets and no personal data the subscriber may not see: `transform()` can remove fields per subscriber.
- A receiver gives the payload to a model: text in it that came from users is untrusted input there.

## Polling

A client that cannot receive webhooks reads an event with `events/poll`. There is no subscribe step: each request names
the event, its arguments and the cursor the last answer returned.

```json
{
  "method": "events/poll",
  "params": { "name": "order.created", "arguments": { "status": "paid" }, "cursor": null, "maxEvents": 50 }
}
```

```json
{
  "events": [
    {
      "eventId": "evt_Zk3…",
      "name": "order.created",
      "timestamp": "2026-10-02T12:00:00.000Z",
      "data": { "orderId": "o-1", "status": "paid", "total": 42 }
    }
  ],
  "cursor": "5f0c…a1.42",
  "truncated": false,
  "hasMore": false,
  "nextPollMs": 30000
}
```

- A `cursor` of `null`, or none, means "from now": the answer has no events and the current position.
- `maxEvents` caps the events of one answer, within `events.poll.maxEvents` (100). When more are waiting, the answer
  has `hasMore: true` and a cursor to poll again from at once.
- `nextPollMs` is `events.poll.nextPollMs` (30 seconds), or what the event's `check()` returned.
- `maxAgeMs` with a cursor skips what is older, and sets `truncated: true` when it skipped something. It is ignored
  with a `null` cursor.
- `truncated: true` means events were skipped. It is never an error: the answer carries a cursor to continue from.
- Under protocol 2026-07-28 the client sends the event name in the `Mcp-Name` header, and the result has
  `resultType: "complete"`.

The server performs the poll mode on every runtime and in every auth mode, unless `events.poll.enabled` is `false`.

### Who may poll

The checks of `events/subscribe` apply to every poll, with the same errors and codes: the event exists and is offered
by poll (`NotFound`, `Unsupported`), the event's `authorities` allow the caller with the arguments as input
(`Forbidden`), the arguments match `inputSchema` (`-32602`), and `authorize()` does not throw (`Forbidden`). A caller
who loses access is refused at its next poll.

An anonymous caller may poll on a server in public auth mode. Its `subscriber` has an empty `sub` and no roles, so an
event with `authorities`, or an occurrence published with an `audience`, is not for it. On a server whose auth signs
callers in, an anonymous caller is answered `Forbidden`.

### Events that are published

An event without `check()` is read from a buffer of what `publish()` published: the last `events.buffer.maxEvents`
(10000) occurrences of each event, for `events.buffer.maxAgeMs` (10 minutes). Each poll applies, for its own caller
and arguments, what a webhook delivery applies: the `audience` of the publish (against the caller), a targeted
`subscriptionId`, `match()` and `transform()`.

The buffer is in the memory of one process. Its cursor is `<bootId>.<sequence>`:

- After a restart, or on another process, a cursor cannot be placed: the answer has no events, a fresh cursor and
  `truncated: true`.
- A cursor older than what the buffer still holds is answered with what is left and `truncated: true`.

Behind a load balancer, each process has its own buffer. Use a `check()` event, or the webhook mode, when that matters.

### Events with `check()`

An event whose upstream can replay declares `check()`. The cursor is then the upstream's own, so a poll survives a
restart and works on any process:

```typescript
export const ticketUpdated = event({
  name: 'ticket.updated',
  inputSchema: { queue: z.string().optional() },
  payloadSchema: { ticketId: z.string(), queue: z.string() },
  async check(args, cursor, limits) {
    if (cursor === null) return { events: [], cursor: await tickets.currentPosition() };
    const page = await tickets.changesSince(cursor, { queue: args.queue, limit: limits?.maxEvents });
    return {
      events: page.changes.map((change) => ({ data: { ticketId: change.id, queue: change.queue } })),
      cursor: page.position,
      hasMore: page.hasMore,
    };
  },
});
```

- `check(args, null)` returns no events and the current position.
- Each item is `{ data, eventId?, timestamp? }`. `data` must match `payloadSchema`; an item without an id or a time
  gets `evt_…` and the time of the poll.
- `limits` is `{ maxEvents, maxAgeMs? }` from the request. `check()` must return at most `limits.maxEvents` items,
  with a cursor after the last one it returned and `hasMore: true` when more are waiting: the server fails a poll
  whose `check()` returned more, with `InvalidEventPublishError` (`check() returned <n> events, more than
limits.maxEvents (<max>)`), rather than drop events past the cursor. It also leaves out items whose `timestamp` is
  older than `maxAgeMs`.
- The answer may set `truncated`, `hasMore` and `nextPollMs`; they go to the client as they are.
- `match()`, `transform()` and `audience` do not apply: `check()` gets the arguments and filters itself.

### The poll subscription

Poll has no goodbye, so for an event with `onSubscribe` or `onUnsubscribe` the server keeps a lease per caller, event
and arguments (anonymous callers share one):

- `onSubscribe(args, subscription)` runs at the first poll, with `subscription.mode` `'poll'`. When it throws, the
  poll fails and no lease starts.
- Each poll renews the lease. It lasts five poll intervals, and at least five minutes.
- `onUnsubscribe(args, subscription, 'expired')` runs when no poll renewed it in time.
- A caller may hold `subscriptions.maxPerPrincipal` leases; one more is answered `ResourceExhausted`. The anonymous
  callers of a public server count as one caller, so together they hold at most that many.
- Two first polls at the same time start one lease: `onSubscribe` runs once, and the second poll waits for it.

Leases are in memory and never stored: after a restart, the next poll runs `onSubscribe` again.
`publish(event, data, { subscriptionId: subscription.id })` reaches that poll subscription alone.

### Hooks

`events/poll` runs the hookable `events:poll` flow (`EventPollHook`), with the stages `parseInput`, `resolveDialect`,
`findEvent`, `resolveReader`, `checkEntryAuthorities`, `validateArguments`, `authorize`, `renewLease`, `readEvents`,
`buildResult` and `finalize`. `finalize` runs after a success or a failure: attach a hook that must see every poll to
it with `Finally`. With `@frontmcp/observability`, each poll is traced as an `events/poll` span, ended in `finalize`.

## Streaming

A client that holds a connection gets events as they happen with `events/stream`, the push mode. One request is one
subscription: it stays open, and the server sends notifications on it until the client cancels or disconnects.

```json
{ "jsonrpc": "2.0", "id": 1, "method": "events/stream", "params": { "name": "order.created", "cursor": null } }
```

The notifications of a stream, in order:

| Notification                      | When                                                | `params`                                   |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `notifications/events/active`     | First, and again when a gap is found                | `{ cursor, truncated }`                    |
| `notifications/events/event`      | For each occurrence the reader may receive          | The occurrence, with the `cursor` after it |
| `notifications/events/heartbeat`  | Every `events.push.heartbeatMs` (25 seconds)        | `{ cursor }`                               |
| `notifications/events/error`      | A `check()` failed; the stream stays open           | `{ error }`                                |
| `notifications/events/terminated` | The server ends the subscription; the stream closes | `{ error }`                                |

Every notification has `params._meta["io.modelcontextprotocol/subscriptionId"]`, the `id` of the `events/stream`
request. When the server closes the stream, the request is answered with an empty result that has the same `_meta`.

- **Streamable HTTP, protocol 2026-07-28**: the response of the POST is an SSE stream. The client sends the event
  name in the `Mcp-Name` header, and ends the stream by closing the connection. The final frame is
  `{ "id": 1, "result": { "resultType": "complete", "_meta": { ... } } }`.
- **A session opened with `initialize`, and stdio**: the notifications are sent on the session. The client ends the
  stream with `notifications/cancelled` for the request's `id`.
- A refusal is a JSON-RPC error answer, and no stream opens. The checks and the rule for anonymous callers are those
  of [`events/poll`](#who-may-poll), with `Unsupported` for an event that is not offered by push.
- A `cursor` replays what the buffer of published events still holds after it (see
  [Events that are published](#events-that-are-published)); `null`, or none, starts from now. The `cursor` of an
  `event` or a `heartbeat` is the one to open the next stream, or to poll, from.
- An event with `check()` is read by calling it when the stream opens and then at its `nextPollMs`
  (`events.poll.nextPollMs` when it names none), at once while it answers `hasMore`.
- A reader the event's `authorities` or `authorize()` no longer allow is ended with `terminated` and
  `{ "code": -32024, "message": "Forbidden", "data": { "reason": "Access revoked" } }`. Access is checked again
  every `subscriptions.reauthorizeEveryMs` (see [Over a subscription's life](#over-a-subscriptions-life)).
- A client that reads too slowly gets a gap, not memory growth: past 1000 waiting notifications, they are replaced by
  one `active` with `truncated: true`.

`onSubscribe(args, subscription)` runs when the stream opens, with `subscription.mode` `'push'`; when it throws, the
request fails. `onUnsubscribe(args, subscription, 'closed')` runs when the stream ends. A caller may hold
`subscriptions.maxPerPrincipal` streams open; one more is answered `ResourceExhausted`.

The server performs the push mode unless `events.push.enabled` is `false`, except in a serverless deployment, where
no process lives long enough to hold a stream.

### Several processes

A stream is held by one process. An event published on another process reaches it when the events store can relay:
with `events.store.redis` and an auth mode that signs callers in, each process relays what it publishes to the
others, which also keep it in their buffer for `events/poll`. Without it, a stream carries what its own process
publishes, and the server logs at startup:
`Event streams carry what this process publishes. With several processes, set events.store.redis so an event
published on one reaches the streams the others hold.`

### Hooks

Opening a stream runs the hookable `events:stream` flow (`EventStreamHook`), with the stages `parseInput`,
`resolveDialect`, `findEvent`, `resolveReader`, `checkEntryAuthorities`, `validateArguments`, `authorize`,
`openStream` and `buildResult`. `scope.events.streams` is the server's `EventStreams` (`size`, `isRelayed`). With
`@frontmcp/observability`, opening a stream is traced as an `events/stream` span.

## Capabilities

A server that serves events advertises them in two places, on every transport (`initialize` over HTTP, SSE and stdio,
and `server/discover` under 2026-07-28):

```json
{
  "capabilities": {
    "events": {},
    "extensions": { "io.modelcontextprotocol/events": {} }
  }
}
```

`extensions` is where SEP-3415 puts it. The top-level `events` key is where the design sketch before it put it, and
where ChatGPT looks.

## Server Options

```typescript
@FrontMcp({
  info: { name: 'shop', version: '1.0.0' },
  apps: [OrdersApp],
  events: { compat: 'auto' },
})
class ShopServer {}
```

| Field      | Type                               | Default  | Notes                                                                                                                       |
| ---------- | ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `enabled?` | `boolean`                          | Not set  | Events are on once an app declares one. `false` turns them off; `true` starts the event registry without any declared event |
| `compat?`  | `'auto' \| 'sep-3415' \| 'sketch'` | `'auto'` | The dialect subscriptions and deliveries use: SEP-3415, or the design sketch ChatGPT implements. `'auto'` picks per caller  |

`events.store` (where subscriptions are kept; `redis` or `sqlite`, not both):

| Field        | Type            | Default                                 | Notes                                    |
| ------------ | --------------- | --------------------------------------- | ---------------------------------------- |
| `redis?`     | Redis options   | None                                    | A Redis server. Vercel KV is refused     |
| `sqlite?`    | `{ path, ... }` | None                                    | A SQLite file; `path` is required        |
| `keyPrefix?` | `string`        | `mcp:events:<hash of the server name>:` | The prefix of every key the store writes |

`events.subscriptions`:

| Field                 | Type      | Default               | Notes                                                                       |
| --------------------- | --------- | --------------------- | --------------------------------------------------------------------------- |
| `defaultTtlMs?`       | `number`  | `3600000` (1 hour)    | The lifetime of a subscription that asks for none                           |
| `maxTtlMs?`           | `number`  | `86400000` (24 hours) | The longest lifetime granted                                                |
| `minTtlMs?`           | `number`  | `60000` (1 minute)    | The shortest lifetime granted                                               |
| `allowNoExpiry?`      | `boolean` | `false`               | Grants `ttlMs: null`. Needs `events.store.redis` or `events.store.sqlite`   |
| `maxPerPrincipal?`    | `number`  | `100`                 | How many subscriptions one caller may hold                                  |
| `reauthorizeEveryMs?` | `number`  | `300000` (5 minutes)  | How often a publish checks an owner against `authorities` and `authorize()` |
| `suspendedTtlMs?`     | `number`  | `604800000` (7 days)  | How long a suspended subscription without expiry is kept                    |

The three lifetimes must satisfy `minTtlMs <= defaultTtlMs <= maxTtlMs` after defaults: a server that lowers
`maxTtlMs` below one hour sets `defaultTtlMs` too.

`events.webhook`:

| Field                        | Type       | Default              | Notes                                                                       |
| ---------------------------- | ---------- | -------------------- | --------------------------------------------------------------------------- |
| `enabled?`                   | `boolean`  | `true`               | `false` turns webhook delivery off                                          |
| `allowedCallbacks?`          | `string[]` | `[]`                 | Callback URL prefixes accepted without a verification request               |
| `unsafeAllowLocalCallbacks?` | `boolean`  | `false`              | Test-only: also accepts `http:` callbacks and loopback or private addresses |
| `verification.cacheTtlMs?`   | `number`   | `3600000` (1 hour)   | How long a callback a caller proved stays verified for that caller          |
| `verification.timeoutMs?`    | `number`   | `10000`              | How long the callback has to answer the verification request                |
| `rotationGraceMs?`           | `number`   | `300000` (5 minutes) | How long deliveries are also signed with a replaced secret                  |

`events.webhook.delivery`:

| Field            | Type     | Default               | Notes                                                              |
| ---------------- | -------- | --------------------- | ------------------------------------------------------------------ |
| `timeoutMs?`     | `number` | `10000`               | How long a callback has to answer one delivery                     |
| `maxAttempts?`   | `number` | `5`                   | How many times one delivery is attempted                           |
| `retryWindowMs?` | `number` | `900000` (15 minutes) | How long after its first attempt a delivery is still retried       |
| `backoffMs?`     | `number` | `1000`                | The wait before the second attempt; must not exceed `maxBackoffMs` |
| `maxBackoffMs?`  | `number` | `60000`               | The longest wait between two attempts                              |
| `concurrency?`   | `number` | `16`                  | How many deliveries are in flight at once in one process           |

`events.publishEndpoint` (see [Publishing over HTTP](#publishing-over-http)):

| Field          | Type                           | Default           | Notes                                                                                           |
| -------------- | ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------- |
| `enabled?`     | `boolean`                      | `false`           | Serves the endpoint                                                                             |
| `path?`        | `string`                       | `/events/publish` | Starts with `/`, literal segments only: no `:name` parameter, query or fragment                 |
| `secret?`      | `string`                       | None              | At least 32 characters. Requests are signed with it; without it, callers present a bearer token |
| `authorities?` | Profile name, names, or policy | None              | The rule a bearer caller must satisfy, with the request body as input. Not with `secret`        |

`events.buffer` (what `events/poll` can still read of published events):

| Field        | Type     | Default               | Notes                                               |
| ------------ | -------- | --------------------- | --------------------------------------------------- |
| `maxAgeMs?`  | `number` | `600000` (10 minutes) | How long a published occurrence can still be polled |
| `maxEvents?` | `number` | `10000`               | How many occurrences are kept for one event         |

`events.poll`:

| Field         | Type      | Default | Notes                                            |
| ------------- | --------- | ------- | ------------------------------------------------ |
| `enabled?`    | `boolean` | `true`  | `false` turns `events/poll` off                  |
| `nextPollMs?` | `number`  | `30000` | The wait between two polls the server recommends |
| `maxEvents?`  | `number`  | `100`   | The most occurrences one poll returns            |

`events.push`:

| Field          | Type      | Default | Notes                                                      |
| -------------- | --------- | ------- | ---------------------------------------------------------- |
| `enabled?`     | `boolean` | `true`  | `false` turns `events/stream` off                          |
| `heartbeatMs?` | `number`  | `25000` | How often an open stream sends a heartbeat with its cursor |

With `enabled: false`, the server logs `Events are disabled (events.enabled: false), so the 2 event(s) apps declare are
not served.` and `scope.events` is `undefined`. Otherwise `scope.events` is the `EventRegistry`: `getEvents()`,
`findByName(name)`, `servesEvents()`.

## Typed Arguments and Payloads

`event()` infers both types from its schemas. A class declares them on `EventContext`, and `@Event` checks them against
the schemas:

```typescript
import { Event, EventContext, z, type EventPayloadOf } from '@frontmcp/sdk';

const payloadSchema = { orderId: z.string(), total: z.number() };
type OrderPayload = EventPayloadOf<{ payloadSchema: typeof payloadSchema }>;

@Event({ name: 'order.paid', payloadSchema })
class OrderPaid extends EventContext<Record<string, never>, OrderPayload> {}

type Payload = EventPayloadOf<typeof OrderPaid>; // { orderId: string; total: number }
```

`EventInputOf<T>` and `EventPayloadOf<T>` read the types of an `@Event` class, of what `event()` returns, or of an
options object. A class that extends plain `EventContext` is not checked, and its types are `Record<string, unknown>`.

## Methods of an Event

`EventContext` declares optional methods, which `event()` takes beside its options. Every mode calls `authorize`,
`onSubscribe` and `onUnsubscribe`; publishing, polling and streaming call `match` and `transform`; polling and
streaming call `check`. `subscriber` is the owner of the
subscription: `{ sub, iss?, tenantId?, roles, permissions, scopes, claims }`. `tenantId` is set when
`authorities.claimsMapping.tenantId` names the claim that holds it.

| Method                                      | Purpose                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `authorize(args, subscriber)`               | Throw to refuse a subscription; run again over its life                       |
| `match(event, args, subscriber)`            | Whether a subscription receives a published event. Without it, every one does |
| `transform(event, args, subscriber)`        | The event as one subscription receives it                                     |
| `check(args, cursor, limits?)`              | The events since `cursor`, for an upstream that can replay                    |
| `onSubscribe(args, subscription)`           | Set up what the subscription needs upstream                                   |
| `onUnsubscribe(args, subscription, reason)` | Tear it down: `'unsubscribed'`, `'expired'`, `'closed'` or `'terminated'`     |

In a class they are methods with `this.get()` and `this.fetch()`. In `event()`, write them as methods (not arrow
functions) to get the same `this`.

## Common Patterns

| Pattern            | Correct                                     | Incorrect                                        | Why                                                             |
| ------------------ | ------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Event names        | `order.created`, `incident.resolved`        | `Order Created`, `orderCreatedV2Final`           | No whitespace is allowed, and a name outlives its subscriptions |
| Payloads           | An id and what a client needs to triage     | The whole record, with user text and attachments | Payloads sit in logs and queues, and are untrusted model input  |
| Breaking changes   | A new name served beside the old one        | Retyping a field of an existing name             | Subscriptions outlive the `events/list` they were created from  |
| Restricted events  | `authorities` on the event                  | Checking the caller in `match()` only            | A caller should not see an event it may not subscribe to        |
| Internal events    | `hideFromDiscovery: true`                   | Leaving it listed and hoping nobody subscribes   | Listed events are offered to the client's model                 |
| One name per event | `availableWhen` on two variants of one name | Two events of one name in one runtime            | The second one fails startup                                    |

## Verification Checklist

### Configuration

- [ ] The event class extends `EventContext`, or the event is built with `event()`
- [ ] It is in the `events` array of an `@App` that is not lazy
- [ ] Its `name` has no whitespace and is unique in the server
- [ ] `payloadSchema` (and `inputSchema`, if any) is a raw shape or `z.object()`
- [ ] `@FrontMcp({ authorities })` is set when an event declares `authorities`

### Runtime

- [ ] The server starts: no `EventNameConflictError`, no `Authorities configuration required`
- [ ] `initialize` (or `server/discover`) shows `capabilities.events` and the `io.modelcontextprotocol/events` extension
- [ ] `events/list` shows the event with the expected `delivery`, `inputSchema` and `payloadSchema`
- [ ] A caller without the event's `authorities` does not see it
- [ ] `events/list` offers the event by `poll`, and by `webhook` too when the server's `auth.mode` is not `public`
- [ ] `events/subscribe` answers an `id` and a `refreshBefore`, and the callback received one verification request
- [ ] Subscribing again with the same arguments answers the same `id`
- [ ] `events/unsubscribe` answers `{}`, twice in a row
- [ ] `this.events.publish(...)` answers `matched: 1` for one matching subscription
- [ ] The callback receives one POST whose `webhook-signature` verifies with the subscription's secret
- [ ] A callback that answers `503` twice gets a third attempt with the same `webhook-id`
- [ ] With `events.publishEndpoint.enabled`, a signed `POST /events/publish` answers `202`, and an unsigned one `401`
- [ ] The same `eventId` posted twice is delivered once
- [ ] `events/poll` with a `null` cursor answers no events and a cursor; a poll from that cursor answers what was
      published since
- [ ] `events/stream` sends `notifications/events/active` first, then an `event` for what is published

## Troubleshooting

| Problem                                                  | Cause                                                                                  | Solution                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `events/list` answers `-32601`                           | The server performs no delivery mode, or declares no event                             | Enable a delivery mode; list the event in an app's `events`                             |
| The capability is missing from `initialize`              | Same as above                                                                          | Same as above                                                                           |
| An event is missing from `events/list`                   | `hideFromDiscovery`, `authorities`, `availableWhen`, or `delivery`                     | Check each: the event's `delivery` must include a mode the server performs              |
| `events items must be annotated with @Event()`           | Something else is in `events`                                                          | List `@Event` classes and what `event()` returns                                        |
| `EventNameConflictError`                                 | Two events with one name                                                               | Rename one, or give the variants `availableWhen`                                        |
| `Authorities configuration required: Event "..."`        | The event declares `authorities` the server does not enforce                           | Add `@FrontMcp({ authorities })`, or remove the event's `authorities`                   |
| A type error on the class under `@Event`                 | `EventContext<Args, Payload>` differs from the schemas                                 | Declare the types the schemas describe, or extend plain `EventContext`                  |
| The app cannot be lazy: `it declares events`             | Events are registered at startup                                                       | Import the app normally                                                                 |
| `Webhook event delivery is off` at startup               | The server runs in public auth mode                                                    | Configure an `auth.mode` that signs callers in                                          |
| `events/subscribe` answers `Forbidden`                   | An anonymous caller, the event's `authorities`, or `authorize()`                       | Read `data.reason`; sign the caller in, or grant the role                               |
| `events/subscribe` answers `CallbackEndpointError`       | The callback did not answer the challenge with `2xx` and the nonce                     | Echo `challenge` from the verification request; read `data.reason`                      |
| `Invalid delivery.url: it must use https`                | An `http:` callback                                                                    | Use `https`; in tests only, `events.webhook.unsafeAllowLocalCallbacks`                  |
| `Invalid delivery.secret`                                | The secret is not `whsec_` and 24 to 64 bytes of base64                                | Generate one with `generateStandardWebhookSecret()` from `@frontmcp/utils`              |
| `Event subscription store: ... needs a secret`           | `events.store` is set and no secret is                                                 | Set `MCP_EVENTS_SECRET`                                                                 |
| A subscription is gone after a restart                   | Subscriptions are kept in memory by default                                            | Set `events.store.sqlite` or `events.store.redis`                                       |
| `publish()` answers `matched: 0`                         | No subscription, `audience`, `match()`, or a suspended one                             | Check `events/subscribe` succeeded and what `match()` returns                           |
| `events/poll` answers `truncated: true`                  | The server restarted, another process answered, or the cursor is older than the buffer | Continue from the cursor of the answer; read current state with a tool if a gap matters |
| A poll misses events behind a load balancer              | Each process buffers what it published                                                 | Declare `check()` on the event, or use the webhook mode                                 |
| A stream misses events published on another process      | Streams carry what their own process publishes                                         | Set `events.store.redis`, with an auth mode that signs callers in                       |
| `events/stream` answers `-32601`                         | `events.push.enabled` is `false`, or the deployment is serverless                      | Use `events/poll` or the webhook mode there                                             |
| A stream sends `active` with `truncated: true` again     | The client read too slowly, or `check()` reported a gap                                | Read current state with a tool if a gap matters; continue on the stream                 |
| `events/poll` answers `Forbidden` to an anonymous caller | The server's auth signs callers in                                                     | Send a token; only a server in public auth mode lets anonymous callers poll             |
| `EventNotRegisteredError` on `publish()`                 | The event is not in any app's `events`                                                 | List it, or publish the name that is registered                                         |
| `InvalidEventPublishError` on `publish()`                | `data` does not match `payloadSchema`                                                  | Send the fields the schema declares                                                     |
| A receiver gets the same event twice                     | Delivery is at least once: a retry after a lost `2xx`                                  | Deduplicate on `webhook-id`                                                             |
| `Event publish endpoint: ... public auth mode`           | `publishEndpoint.enabled` without a `secret` on a public server                        | Set `events.publishEndpoint.secret`, or an `auth.mode` that signs in                    |
| `POST /events/publish` answers `401`                     | A wrong signature, a clock that is off, or a request sent before                       | Sign `<timestamp>.<body>` over the bytes sent; sign a retry again                       |
| `POST /events/publish` answers `404`                     | The endpoint is off, the path differs, or the event is unknown                         | Set `events.publishEndpoint.enabled`; read the `error` of the answer                    |
| `POST /events/publish` answers `409`                     | Another request is publishing the same `eventId` right now                             | Retry: the answer is then the first request's                                           |
| `Delivery ... is abandoned` in the log                   | The callback failed every attempt in the retry window                                  | Fix the callback; read the category at the end of the line                              |
| `Subscription ... is suspended` in the log               | 20 failed deliveries in a row                                                          | Fix the callback, then subscribe again to reactivate                                    |
| The signature does not verify at the receiver            | It signs a re-serialized body, or uses another secret                                  | Verify over the raw body bytes with the secret sent in `events/subscribe`               |

## Reference

- [MCP Events, SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415)
- [Standard Webhooks](https://www.standardwebhooks.com): the signature scheme of deliveries
- Related skills: `decorators-guide`, `create-plugin-hooks` (`ListEventsHook`, `EventSubscribeHook`,
  `EventUnsubscribeHook`, `EventPublishHook`, `EventPublishHttpHook`, `EventDeliverHook`, `EventPollHook`,
  `EventStreamHook`), `frontmcp-authorities`, `frontmcp-channels`, `create-job`, `create-duty`, `create-workflow`
  (the request signature)
