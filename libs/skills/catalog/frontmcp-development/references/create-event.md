---
name: create-event
description: Declare the event types clients list with events/list and subscribe to (MCP Events, SEP-3415) with @Event or event(), with a name, argument and payload schemas, authorities and delivery modes
---

# Events: What Clients Can Subscribe To

An event is a named kind of thing that happens in your system: an order is placed, an incident opens, a comment is
added. A client lists the server's event types with `events/list`, subscribes to one with arguments, and receives its
occurrences when no user is connected. This is MCP Events, the `io.modelcontextprotocol/events` extension (SEP-3415),
which ChatGPT reads from the top-level `events` capability.

This reference covers declaring events, what `events/list` answers, and how a client subscribes by webhook with
`events/subscribe`. An event is listed once the server performs a delivery mode the event allows (see
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

`events/list` answers one definition per event:

```json
{
  "events": [
    {
      "name": "order.created",
      "description": "Fires when an order is placed",
      "delivery": ["webhook"],
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

| Server performs   | Event's `delivery` | Offered in                     |
| ----------------- | ------------------ | ------------------------------ |
| `webhook`         | Not set            | `webhook`                      |
| `webhook`, `poll` | `['poll']`         | `poll`                         |
| `webhook`         | `['poll']`         | Not served: no mode is left    |
| None              | Any                | No event is served (see below) |

A server that performs no delivery mode serves no events: it does not advertise the capability, and `events/list`
answers `-32601` (Method not found), as on a server without events. Declared events are still registered and checked
at startup.

The server performs `webhook` when its auth signs callers in (any `auth.mode` other than `public`) and
`events.webhook.enabled` is not `false`. A subscription belongs to a caller, so in public mode the server logs
`Webhook event delivery is off: the server runs in public auth mode, so a subscription would have no owner.` and
serves no events. `poll` and `push` are not performed yet.

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

## `events/list`

- Events are ordered by name.
- Answers come in pages of 40. A page that is not the last has a `nextCursor`, which the client sends back as `cursor`.
  A `cursor` of `null`, or none, asks for the first page. A cursor is base64-encoded JSON with an `offset`: one that
  does not decode, whose offset is not a non-negative integer, or whose offset is past the end of the caller's list is
  refused as invalid input. The server does not check that it issued the cursor.
- Under protocol 2026-07-28 the result has `resultType: "complete"`. It carries no cache hints.
- The request runs the hookable `events:list` flow, with the stages `parseInput`, `findEvents`,
  `filterByAvailability`, `filterByAuthorities`, `filterByDiscovery` and `parseEvents`. Hook it with `ListEventsHook`:

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
`verifyCallback`, `grantTtl`, `upsertSubscription`, `notifySubscribed` and `buildResult`. `events:unsubscribe`
(`EventUnsubscribeHook`) has `parseInput`, `resolveDialect`, `requireSubscriber`, `removeSubscription` and
`buildResult`.

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

| Field              | Type      | Default               | Notes                                                                     |
| ------------------ | --------- | --------------------- | ------------------------------------------------------------------------- |
| `defaultTtlMs?`    | `number`  | `3600000` (1 hour)    | The lifetime of a subscription that asks for none                         |
| `maxTtlMs?`        | `number`  | `86400000` (24 hours) | The longest lifetime granted                                              |
| `minTtlMs?`        | `number`  | `60000` (1 minute)    | The shortest lifetime granted                                             |
| `allowNoExpiry?`   | `boolean` | `false`               | Grants `ttlMs: null`. Needs `events.store.redis` or `events.store.sqlite` |
| `maxPerPrincipal?` | `number`  | `100`                 | How many subscriptions one caller may hold                                |

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
| `rotationGraceMs?`           | `number`   | `300000` (5 minutes) | How long a replaced secret stays on the subscription                        |

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

`EventContext` declares optional methods, which `event()` takes beside its options. Subscriptions call `authorize`,
`onSubscribe` and `onUnsubscribe`; `match`, `transform` and `check` are for delivery. `subscriber` is the owner of the
subscription: `{ sub, iss?, tenantId?, roles, permissions, scopes, claims }`. `tenantId` is set when
`authorities.claimsMapping.tenantId` names the claim that holds it.

| Method                                      | Purpose                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `authorize(args, subscriber)`               | Throw to refuse a subscription the event's `authorities` allow                |
| `match(event, args, subscriber)`            | Whether a subscription receives a published event. Without it, every one does |
| `transform(event, args, subscriber)`        | The event as one subscription receives it                                     |
| `check(args, cursor)`                       | The events since `cursor`, for an upstream that can replay                    |
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
- [ ] The server's `auth.mode` is not `public`, so events are served
- [ ] `events/subscribe` answers an `id` and a `refreshBefore`, and the callback received one verification request
- [ ] Subscribing again with the same arguments answers the same `id`
- [ ] `events/unsubscribe` answers `{}`, twice in a row

## Troubleshooting

| Problem                                            | Cause                                                              | Solution                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `events/list` answers `-32601`                     | The server performs no delivery mode, or declares no event         | Enable a delivery mode; list the event in an app's `events`                |
| The capability is missing from `initialize`        | Same as above                                                      | Same as above                                                              |
| An event is missing from `events/list`             | `hideFromDiscovery`, `authorities`, `availableWhen`, or `delivery` | Check each: the event's `delivery` must include a mode the server performs |
| `events items must be annotated with @Event()`     | Something else is in `events`                                      | List `@Event` classes and what `event()` returns                           |
| `EventNameConflictError`                           | Two events with one name                                           | Rename one, or give the variants `availableWhen`                           |
| `Authorities configuration required: Event "..."`  | The event declares `authorities` the server does not enforce       | Add `@FrontMcp({ authorities })`, or remove the event's `authorities`      |
| A type error on the class under `@Event`           | `EventContext<Args, Payload>` differs from the schemas             | Declare the types the schemas describe, or extend plain `EventContext`     |
| The app cannot be lazy: `it declares events`       | Events are registered at startup                                   | Import the app normally                                                    |
| `Webhook event delivery is off` at startup         | The server runs in public auth mode                                | Configure an `auth.mode` that signs callers in                             |
| `events/subscribe` answers `Forbidden`             | An anonymous caller, the event's `authorities`, or `authorize()`   | Read `data.reason`; sign the caller in, or grant the role                  |
| `events/subscribe` answers `CallbackEndpointError` | The callback did not answer the challenge with `2xx` and the nonce | Echo `challenge` from the verification request; read `data.reason`         |
| `Invalid delivery.url: it must use https`          | An `http:` callback                                                | Use `https`; in tests only, `events.webhook.unsafeAllowLocalCallbacks`     |
| `Invalid delivery.secret`                          | The secret is not `whsec_` and 24 to 64 bytes of base64            | Generate one with `generateStandardWebhookSecret()` from `@frontmcp/utils` |
| `Event subscription store: ... needs a secret`     | `events.store` is set and no secret is                             | Set `MCP_EVENTS_SECRET`                                                    |
| A subscription is gone after a restart             | Subscriptions are kept in memory by default                        | Set `events.store.sqlite` or `events.store.redis`                          |

## Reference

- [MCP Events, SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415)
- Related skills: `decorators-guide`, `create-plugin-hooks` (`ListEventsHook`, `EventSubscribeHook`,
  `EventUnsubscribeHook`), `frontmcp-authorities`, `frontmcp-channels`, `create-job`, `create-duty`
