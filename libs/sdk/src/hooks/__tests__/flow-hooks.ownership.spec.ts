import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  Adapter,
  App,
  FlowHooksOf,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type AdapterInterface,
  type FlowCtxOf,
  type FrontMcpAdapterResponse,
} from '../../common';

const ToolHook = FlowHooksOf('tools:call-tool');
const ReadResourceHook = FlowHooksOf('resources:read-resource');
const GetPromptHook = FlowHooksOf('prompts:get-prompt');

const hookRuns: string[] = [];

function textResource(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: 'ok' }] };
}

function textPrompt(): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] };
}

@Plugin({ name: 'entry-audit' })
class EntryAuditPlugin {
  @ToolHook.Will('execute')
  onToolCall(ctx: FlowCtxOf<'tools:call-tool'>) {
    hookRuns.push(`tool:${ctx.state.tool?.name}`);
  }

  @ReadResourceHook.Will('execute')
  onResourceRead(ctx: FlowCtxOf<'resources:read-resource'>) {
    hookRuns.push(`resource:${ctx.state.resource?.name}`);
  }

  @GetPromptHook.Will('execute')
  onPromptGet(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    hookRuns.push(`prompt:${ctx.state.prompt?.name}`);
  }
}

@Tool({ name: 'list_orders', inputSchema: {} })
class ListOrdersTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Tool({ name: 'get_order', inputSchema: {} })
class GetOrderTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Resource({ name: 'order-feed', uri: 'orders://feed' })
class OrderFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@ResourceTemplate({ name: 'order-by-id', uriTemplate: 'orders://order/{id}' })
class OrderByIdResource extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'order-summary', arguments: [] })
class OrderSummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt();
  }
}

@Adapter({ name: 'orders-api' })
class OrdersApiAdapter implements AdapterInterface {
  options = { name: 'orders-api' };

  fetch(): FrontMcpAdapterResponse {
    return { tools: [GetOrderTool], resources: [OrderFeedResource, OrderByIdResource], prompts: [OrderSummaryPrompt] };
  }
}

@Tool({ name: 'export_orders', inputSchema: {} })
class ExportOrdersTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Resource({ name: 'export-log', uri: 'orders://export-log' })
class ExportLogResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'export-plan', arguments: [] })
class ExportPlanPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt();
  }
}

@Plugin({
  name: 'order-exports',
  tools: [ExportOrdersTool],
  resources: [ExportLogResource],
  prompts: [ExportPlanPrompt],
})
class OrderExportsPlugin {}

@Tool({ name: 'archive_orders', inputSchema: {} })
class ArchiveOrdersTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Plugin({ name: 'order-archive', tools: [ArchiveOrdersTool] })
class OrderArchivePlugin {}

@Plugin({ name: 'order-maintenance', plugins: [OrderArchivePlugin] })
class OrderMaintenancePlugin {}

@App({
  id: 'orders',
  name: 'Orders',
  tools: [ListOrdersTool],
  adapters: [OrdersApiAdapter],
  plugins: [EntryAuditPlugin, OrderExportsPlugin, OrderMaintenancePlugin],
})
class OrdersApp {}

@Tool({ name: 'get_invoice', inputSchema: {} })
class GetInvoiceTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@Resource({ name: 'invoice-feed', uri: 'invoices://feed' })
class InvoiceFeedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@Prompt({ name: 'invoice-summary', arguments: [] })
class InvoiceSummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt();
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  tools: [GetInvoiceTool],
  resources: [InvoiceFeedResource],
  prompts: [InvoiceSummaryPrompt],
})
class BillingApp {}

describe('app plugin hooks run for every entry the app provides', () => {
  let server: TestFetchServer;

  async function hooksFor(method: string, params: Record<string, unknown>): Promise<string[]> {
    hookRuns.length = 0;
    const { message } = await rpc20260728(server.handler, method, params);
    expect(message.error).toBeUndefined();
    return [...hookRuns];
  }

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'flow-hooks-ownership', version: '1.0.0' },
      apps: [OrdersApp, BillingApp],
    });
  });

  it('runs for a tool declared on the app', async () => {
    expect(await hooksFor('tools/call', { name: 'list_orders', arguments: {} })).toEqual(['tool:list_orders']);
  });

  it('runs for a tool provided by an adapter of the app', async () => {
    expect(await hooksFor('tools/call', { name: 'get_order', arguments: {} })).toEqual(['tool:get_order']);
  });

  it('runs for a tool provided by a plugin of the app', async () => {
    expect(await hooksFor('tools/call', { name: 'export_orders', arguments: {} })).toEqual(['tool:export_orders']);
  });

  it('runs for a tool provided by a plugin nested inside a plugin of the app', async () => {
    expect(await hooksFor('tools/call', { name: 'archive_orders', arguments: {} })).toEqual(['tool:archive_orders']);
  });

  it('runs for a resource provided by an adapter of the app', async () => {
    expect(await hooksFor('resources/read', { uri: 'orders://feed' })).toEqual(['resource:order-feed']);
  });

  it('runs for a resource template provided by an adapter of the app', async () => {
    expect(await hooksFor('resources/read', { uri: 'orders://order/42' })).toEqual(['resource:order-by-id']);
  });

  it('runs for a resource provided by a plugin of the app', async () => {
    expect(await hooksFor('resources/read', { uri: 'orders://export-log' })).toEqual(['resource:export-log']);
  });

  it('runs for a prompt provided by an adapter of the app', async () => {
    expect(await hooksFor('prompts/get', { name: 'order-summary', arguments: {} })).toEqual(['prompt:order-summary']);
  });

  it('runs for a prompt provided by a plugin of the app', async () => {
    expect(await hooksFor('prompts/get', { name: 'export-plan', arguments: {} })).toEqual(['prompt:export-plan']);
  });

  it('does not run for a tool of another app', async () => {
    expect(await hooksFor('tools/call', { name: 'get_invoice', arguments: {} })).toEqual([]);
  });

  it('does not run for a resource of another app', async () => {
    expect(await hooksFor('resources/read', { uri: 'invoices://feed' })).toEqual([]);
  });

  it('does not run for a prompt of another app', async () => {
    expect(await hooksFor('prompts/get', { name: 'invoice-summary', arguments: {} })).toEqual([]);
  });
});
