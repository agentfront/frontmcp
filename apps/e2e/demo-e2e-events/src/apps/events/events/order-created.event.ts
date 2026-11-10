import { z } from '@frontmcp/lazy-zod';
import { event } from '@frontmcp/sdk';

/** Fires when an order is placed. A subscription may ask for the orders of one status only. */
export const orderCreated = event({
  name: 'order.created',
  description: 'Fires when an order is placed',
  inputSchema: { status: z.string().optional(), region: z.string().optional() },
  payloadSchema: { orderId: z.string(), status: z.string(), total: z.number() },
});
