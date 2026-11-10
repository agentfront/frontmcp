import { z } from '@frontmcp/lazy-zod';
import { Workflow } from '@frontmcp/sdk';

/** Started by each published order.created, which the events bridge emits on the server's event bus. */
@Workflow({
  name: 'audit-orders',
  description: 'Records each order.created the server publishes',
  trigger: 'event',
  event: 'order.created',
  inputSchema: {
    eventId: z.string(),
    name: z.string(),
    timestamp: z.string(),
    data: z.record(z.string(), z.unknown()),
  },
  steps: [{ id: 'record', jobName: 'record-occurrence' }],
})
export class AuditOrdersWorkflow {}
