import { App } from '@frontmcp/sdk';

import { auditLogged } from './events/audit-logged.event';
import { orderCreated } from './events/order-created.event';
import { ticketUpdated } from './events/ticket-updated.event';
import PlaceOrderTool from './tools/place-order.tool';
import UpdateTicketTool from './tools/update-ticket.tool';

@App({
  name: 'events',
  description: 'MCP Events E2E: events clients subscribe to by webhook or poll, and tools that make them happen',
  events: [orderCreated, auditLogged, ticketUpdated],
  tools: [PlaceOrderTool, UpdateTicketTool],
})
export class EventsApp {}
