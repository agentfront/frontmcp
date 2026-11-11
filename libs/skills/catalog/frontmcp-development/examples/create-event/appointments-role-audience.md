---
name: appointments-role-audience
reference: create-event
level: intermediate
description: 'A booking service that tells the staff of one business about each booking and replies to the customer who booked, with opaque ids in the payloads.'
tags: [development, event, audience, authorities, webhook]
features:
  - 'Publishing with `audience: { tenantId, roles: { any } }` so only the staff of one business receive an event'
  - 'Publishing with `audience: { sub }` to reach one principal'
  - 'Guarding who may subscribe with `authorities` on the event'
  - 'Opaque conversation ids in payloads instead of identities'
---

# Appointments: Role Audience and Replies to One Customer

A booking service that tells the staff of one business about each booking and replies to the customer who booked, with opaque ids in the payloads.

A customer books with a tool; the admins and receptionists of that business are told. A receptionist replies with
another tool; the customer who booked is told. The runnable app, with a smoke test, is
`apps/e2e/demo-e2e-events-appointments` in the FrontMCP repository.

## Code

```typescript
// src/apps/appointments/events/appointment-created.event.ts
import { event, z } from '@frontmcp/sdk';

export const appointmentCreated = event({
  name: 'appointment.created',
  description: 'A customer booked an appointment with your business',
  payloadSchema: {
    appointmentId: z.string(),
    conversationId: z.string().describe('Opaque id of the conversation with the customer; use it to reply'),
    service: z.string(),
    startsAt: z.string(),
  },
  authorities: 'staff',
});

export const appointmentReply = event({
  name: 'appointment.reply',
  description: 'The business replied about one of your appointments',
  payloadSchema: { appointmentId: z.string(), conversationId: z.string(), message: z.string() },
});
```

```typescript
// src/apps/appointments/tools/book-appointment.tool.ts
@Tool({ name: 'book_appointment', description: 'Book an appointment with a business', inputSchema })
export default class BookAppointmentTool extends ToolContext {
  async execute({ businessId, service, startsAt }: Input) {
    const appointment = bookAppointment({ businessId, service, startsAt, customerSub: this.auth.user.sub });
    const { appointmentId, conversationId } = appointment;
    await this.events.publish(
      appointmentCreated,
      { appointmentId, conversationId, service, startsAt },
      { audience: { tenantId: businessId, roles: { any: ['admin', 'receptionist'] } } },
    );
    return { appointmentId, conversationId };
  }
}
```

```typescript
// src/apps/appointments/tools/reply-to-customer.tool.ts
@Tool({ name: 'reply_to_customer', inputSchema, authorities: 'staff' })
export default class ReplyToCustomerTool extends ToolContext {
  async execute({ appointmentId, message }: Input) {
    const appointment = findAppointment(appointmentId);
    if (!appointment || appointment.businessId !== this.auth.claims['tenantId']) {
      this.fail(new InvalidInputError(`No appointment ${appointmentId} in your business`));
    }
    const { conversationId, customerSub } = appointment;
    const { matched } = await this.events.publish(
      appointmentReply,
      { appointmentId, conversationId, message },
      { audience: { sub: customerSub } },
    );
    return { delivered: matched > 0 };
  }
}
```

```typescript
// src/main.ts (excerpt)
@FrontMcp({
  info: { name: 'Appointments', version: '0.1.0' },
  apps: [AppointmentsApp],
  auth: { mode: 'transparent', provider: idpProviderUrl, expectedAudience, requiredScopes: [] },
  authorities: {
    claimsMapping: { roles: 'roles', tenantId: 'tenantId' },
    profiles: { staff: { roles: { any: ['admin', 'receptionist'] } } },
  },
})
export default class Server {}
```

## What This Demonstrates

- Publishing with `audience: { tenantId, roles: { any } }` so only the staff of one business receive an event
- Publishing with `audience: { sub }` to reach one principal
- Guarding who may subscribe with `authorities` on the event
- Opaque conversation ids in payloads instead of identities

## Notes

- `audience.tenantId` is compared with the subscriber's `tenantId`, which `authorities.claimsMapping.tenantId` reads
  from the token: the staff of another business, subscribed to the same event, do not get the booking.
- `authorities: 'staff'` on the event refuses a customer's `events/subscribe` with `Forbidden`.
- `audience: { sub }` reaches the subscriptions of one principal only.
- The payloads carry `appointmentId` and `conversationId`, never who booked. The server keeps that.
- `matched` counts the webhook deliveries queued; readers that poll or stream are not counted.

## Related

- See `create-event` for audiences, authorities and delivery
