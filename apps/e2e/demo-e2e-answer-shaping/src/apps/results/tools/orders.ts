import { z } from '@frontmcp/sdk';

export const orderSchema = z.object({ id: z.number(), customer: z.string(), status: z.string(), note: z.string() });

/** About 135 KB for 500 orders: over the result-handles threshold and the server's 64 KB answer budget. */
export function orders(count: number) {
  return Array.from({ length: count }, (_, id) => ({
    id,
    customer: `Customer ${id}`,
    status: id % 2 === 0 ? 'open' : 'shipped',
    note: `Order ${id} note `.padEnd(200, '.'),
  }));
}
