import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { GetPromptResult } from '@frontmcp/protocol';

import {
  App,
  FlowHooksOf,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Plugin,
  Prompt,
  PromptContext,
  Provider,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
  type LogRecord,
} from '../../common';

/** What the billing app's own plugin saw: one entry per call it ran for. */
export const billingAudit: string[] = [];

/** The lifecycle hooks the billing app's provider ran. */
export const billingLifecycle: string[] = [];

/** The log lines servers built from {@link lazyServer} wrote, warnings and up plus info. */
export const capturedLogs: Array<{ level: LogLevel; message: string }> = [];

@LogTransport({ name: 'LazyAppCaptureLogger', description: 'Captures log lines for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    capturedLogs.push({ level: record.level, message: record.message });
  }
}

const ToolCallHook = FlowHooksOf('tools:call-tool');

@Plugin({ name: 'billing-audit' })
export class BillingAuditPlugin {
  @ToolCallHook.Will('execute')
  audit() {
    billingAudit.push('call');
  }
}

@Provider({ name: 'billing-ledger' })
class BillingLedger {
  onReady() {
    billingLifecycle.push('ready');
  }
}

@Tool({
  name: 'charge',
  title: 'Charge',
  description: 'Charge a customer',
  inputSchema: { customer: z.string(), cents: z.number().int() },
  outputSchema: { receipt: z.string(), cents: z.number() },
  annotations: { destructiveHint: true },
  aliases: ['billing.charge'],
  tags: ['money'],
  icons: [{ src: 'https://example.com/charge.png' }],
  _meta: { 'acme/team': 'billing' },
  execution: { taskSupport: 'optional' },
})
class ChargeTool extends ToolContext {
  async execute(input: { customer: string; cents: number }) {
    return { receipt: `R-${input.customer}`, cents: input.cents };
  }
}

@Tool({ name: 'refund', description: 'Refund a charge', inputSchema: { receipt: z.string() }, visibility: 'hidden' })
class RefundTool extends ToolContext {
  async execute(input: { receipt: string }) {
    return `refunded ${input.receipt}`;
  }
}

@Tool({ name: 'invoice_export', description: 'Export invoices', inputSchema: {}, enabled: false })
class InvoiceExportTool extends ToolContext {
  async execute() {
    return 'exported';
  }
}

@Tool({
  name: 'balance',
  description: 'The balance, as a number that breaks its output schema',
  inputSchema: {},
  outputSchema: { cents: z.number() },
})
class BrokenBalanceTool extends ToolContext {
  async execute() {
    return { cents: 'not a number' } as unknown as { cents: number };
  }
}

@Tool({
  name: 'ledger',
  description: 'Every ledger line',
  inputSchema: { count: z.number().int() },
  outputSchema: { lines: z.array(z.object({ id: z.number(), memo: z.string() })) },
})
class LedgerTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { lines: Array.from({ length: count }, (_, id) => ({ id, memo: `ledger line ${id} `.padEnd(80, '.') })) };
  }
}

@Resource({ name: 'plans', uri: 'billing://plans', description: 'The price plans', mimeType: 'application/json' })
class PlansResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: '["free","pro"]' }] };
  }
}

@ResourceTemplate({
  name: 'invoice',
  uriTemplate: 'billing://invoices/{id}',
  description: 'One invoice',
  mimeType: 'application/json',
})
class InvoiceTemplate extends ResourceContext {
  async execute(uri: string, params: Record<string, string>) {
    return { contents: [{ uri, text: JSON.stringify({ id: params['id'] }) }] };
  }
}

@Prompt({
  name: 'dunning',
  description: 'Write a payment reminder',
  arguments: [{ name: 'customer', description: 'Who owes', required: true }],
})
class DunningPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: `Remind ${args['customer']}` } }] };
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  description: 'Charges and invoices',
  output: { schemaMode: 'both' },
  providers: [BillingLedger],
  plugins: [BillingAuditPlugin],
  tools: [ChargeTool, RefundTool, InvoiceExportTool, BrokenBalanceTool, LedgerTool],
  resources: [PlansResource, InvoiceTemplate],
  prompts: [DunningPrompt],
})
export class BillingApp {}

export const billingEntries = { ChargeTool, PlansResource, DunningPrompt };

@Tool({ name: 'ping', description: 'Ping the core app', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'core', name: 'Core', tools: [PingTool] })
export class CoreApp {}

/** A loader standing in for `() => import('./billing.app')`, counting its imports. */
export function billingImport(module: unknown = { BillingApp }) {
  return jest.fn(async () => module);
}

/** A server with the eager core app and `billing` as a lazy app imported by `lazy`. */
export function lazyServer(
  lazy: () => Promise<unknown>,
  extra: Partial<FrontMcpConfigInput> = {},
  lazyApp: Record<string, unknown> = {},
): FrontMcpConfigInput {
  return {
    info: { name: 'lazy-apps', version: '1.0.0' },
    apps: [CoreApp, { id: 'billing', name: 'Billing', lazy, ...lazyApp }],
    logging: { level: LogLevel.Info, enableConsole: false, transports: [CaptureLogTransport] },
    ...extra,
  } as FrontMcpConfigInput;
}

/** The same server with `billing` imported eagerly, as a plain `@App` class. */
export function eagerServer(extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  return {
    info: { name: 'lazy-apps', version: '1.0.0' },
    apps: [CoreApp, BillingApp],
    logging: { level: LogLevel.Off },
    ...extra,
  } as FrontMcpConfigInput;
}
