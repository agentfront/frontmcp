import { App } from '@frontmcp/sdk';

import { auditLogged } from './events/audit-logged.event';
import { orderCreated } from './events/order-created.event';
import PlaceOrderTool from './tools/place-order.tool';

@App({
  name: 'events',
  description: 'MCP Events E2E: two events clients subscribe to by webhook, and a tool that publishes one',
  events: [orderCreated, auditLogged],
  tools: [PlaceOrderTool],
})
export class EventsApp {}
