import { Resource, ResourceContext } from '@frontmcp/sdk';

import { orders } from '../tools/orders';

/** About 135 KB of orders as JSON: a read the result-handles plugin folds with `resources: true`. */
@Resource({ name: 'orders-ledger', uri: 'results://orders', mimeType: 'application/json' })
export default class OrdersLedgerResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ orders: orders(500) }) }] };
  }
}
