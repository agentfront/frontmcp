import { App } from '@frontmcp/sdk';

import { auditLogged } from './events/audit-logged.event';
import { orderCreated } from './events/order-created.event';

@App({
  name: 'events',
  description: 'MCP Events E2E: two events clients subscribe to by webhook',
  events: [orderCreated, auditLogged],
})
export class EventsApp {}
