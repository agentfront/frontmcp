---
name: create-event
description: Declare the event types clients list with events/list and subscribe to (MCP Events, SEP-3415) with @Event or event(), with a name, argument and payload schemas, authorities and delivery modes
---

# Events: What Clients Can Subscribe To

An event is a named kind of thing that happens in your system: an order is placed, an incident opens, a comment is
added. A client lists the server's event types with `events/list`, subscribes to one with arguments, and receives its
occurrences when no user is connected. This is MCP Events, the `io.modelcontextprotocol/events` extension (SEP-3415),
which ChatGPT reads from the top-level `events` capability.

This reference covers declaring events. A client can list an event and subscribe to it once the server performs a
delivery mode the event allows (see [Delivery Modes](#delivery-modes)).

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

A server that performs no delivery mode serves no events. Declared events are still registered and checked at
startup. Subscriptions and delivery, which turn the modes on, are the other parts of this version.

## Authorities and Availability

- **`authorities`**: who may list the event and subscribe to it. The server refuses to start when an event declares
  `authorities` and `@FrontMcp({ authorities })` is not set, or when a rule checks nothing:
  `Authorities configuration required: Event "payroll.run" declare 'authorities' metadata ...`.
- **`availableWhen`**: an event the process excludes (`runtime`, `platform`, `deployment`, `env`) is not registered at
  all, so another event may use its name there.

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

`EventContext` declares optional methods, which `event()` takes beside its options. Subscriptions and delivery call
them. `subscriber` is the owner of the subscription: `{ sub, iss?, tenantId?, roles, permissions, scopes, claims }`.

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
- [ ] `scope.events.findByName(name)` returns the event, with the JSON Schemas you expect

## Troubleshooting

| Problem                                           | Cause                                                        | Solution                                                               |
| ------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `events items must be annotated with @Event()`    | Something else is in `events`                                | List `@Event` classes and what `event()` returns                       |
| `EventNameConflictError`                          | Two events with one name                                     | Rename one, or give the variants `availableWhen`                       |
| `Authorities configuration required: Event "..."` | The event declares `authorities` the server does not enforce | Add `@FrontMcp({ authorities })`, or remove the event's `authorities`  |
| A type error on the class under `@Event`          | `EventContext<Args, Payload>` differs from the schemas       | Declare the types the schemas describe, or extend plain `EventContext` |
| The app cannot be lazy: `it declares events`      | Events are registered at startup                             | Import the app normally                                                |

## Reference

- [MCP Events, SEP-3415](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3415)
- Related skills: `decorators-guide`, `frontmcp-authorities`, `frontmcp-channels`, `create-job`, `create-duty`
