import { z } from '@frontmcp/lazy-zod';
import { App, Resource, ResourceContext, Tool, ToolContext } from '@frontmcp/sdk';

/** The side effect that shows this module was imported: how many times, read by the status app's `billing_imports`. */
const marker = globalThis as { __lazyBillingImports?: number };
marker.__lazyBillingImports = (marker.__lazyBillingImports ?? 0) + 1;

@Tool({
  name: 'charge',
  description: 'Charge a customer',
  inputSchema: { customer: z.string(), cents: z.number().int() },
  outputSchema: { receipt: z.string(), cents: z.number() },
})
class ChargeTool extends ToolContext {
  async execute(input: { customer: string; cents: number }) {
    return { receipt: `R-${input.customer}`, cents: input.cents };
  }
}

@Resource({ name: 'plans', uri: 'billing://plans', description: 'The price plans', mimeType: 'application/json' })
class PlansResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: '["free","pro"]' }] };
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  description: 'Charges and plans',
  tools: [ChargeTool],
  resources: [PlansResource],
})
export class BillingApp {}
