import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { orderCreated } from '../events/order-created.event';

const inputSchema = {
  orderId: z.string(),
  status: z.string().default('paid'),
  total: z.number().default(10),
  audienceRole: z.string().optional().describe('Only subscriptions whose owner has this role get the event'),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

@Tool({
  name: 'place-order',
  description: 'Places an order and publishes order.created to its subscribers',
  inputSchema,
})
export default class PlaceOrderTool extends ToolContext {
  async execute({ orderId, status, total, audienceRole }: Input) {
    const audience = audienceRole ? { roles: { any: [audienceRole] } } : undefined;
    return this.events.publish(orderCreated, { orderId, status, total }, { audience });
  }
}
