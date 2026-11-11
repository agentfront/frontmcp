# Appointments: events with a role audience and replies to one customer

A booking service built on MCP Events. A customer books with the `book_appointment` tool; the admins and
receptionists of that business are told with `appointment.created`. A receptionist answers with the
`reply_to_customer` tool; the customer who booked is told with `appointment.reply`. Nobody else hears about either.

| Piece                     | File                                                        |
| ------------------------- | ----------------------------------------------------------- |
| Server, auth, authorities | `src/main.ts`                                               |
| `appointment.created`     | `src/apps/appointments/events/appointment-created.event.ts` |
| `appointment.reply`       | `src/apps/appointments/events/appointment-reply.event.ts`   |
| Booking, publishing       | `src/apps/appointments/tools/book-appointment.tool.ts`      |
| Reply, publishing         | `src/apps/appointments/tools/reply-to-customer.tool.ts`     |
| Smoke test                | `e2e/appointments.e2e.spec.ts`                              |

## What it shows

- **A role audience by tenant.** `book_appointment` publishes with
  `audience: { tenantId: businessId, roles: { any: ['admin', 'receptionist'] } }`. The tenant of a subscriber is the
  `tenantId` claim of its token (`authorities.claimsMapping.tenantId`), so the staff of another business do not get
  the booking, although they are subscribed to the same event.
- **Who may subscribe.** `appointment.created` has `authorities: 'staff'`: a customer who tries to subscribe to it is
  refused with `Forbidden`.
- **A reply to one principal.** `reply_to_customer` publishes with `audience: { sub: customerSub }`. Only the
  subscriptions of that customer receive it.
- **Opaque ids, never identities.** The payloads carry an `appointmentId` and a `conversationId`
  (`conv_<random>`), not the customer's name, subject or email. The business acts on the conversation with a tool,
  under its own authorization; the server keeps who booked.

## Run it

```bash
IDP_PROVIDER_URL=https://your-idp.example.com npx tsx apps/e2e/demo-e2e-events-appointments/src/main.ts
```

The server listens on `PORT` (3160) and accepts the tokens of the identity provider at `IDP_PROVIDER_URL`. A client
such as ChatGPT subscribes with `events/subscribe` and an `https` callback URL. ChatGPT needs the server at a public
HTTPS address.

`EVENTS_ALLOW_LOCAL_CALLBACKS=true` lets callbacks be `http` and local. It is for the smoke test's local receiver
only.

## Test it

```bash
npx nx test demo-e2e-events-appointments
```

Subscriptions are kept in memory: they end with the process. Set `events.store` for a store that survives a
restart (see the `create-event` skill).
