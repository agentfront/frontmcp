import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/** No `enabled` of its own: the server's `enabled` maps it to the invoices feature. */
@Tool({
  name: 'invoice_list',
  description: 'Lists the open invoices; on while the invoices feature is on',
  inputSchema: {},
  outputSchema: { invoices: z.array(z.string()) },
})
export default class InvoiceListTool extends ToolContext {
  async execute() {
    return { invoices: ['INV-1'] };
  }
}
