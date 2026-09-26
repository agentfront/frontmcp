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
  Skill,
  SkillContext,
  Tool,
  ToolContext,
  type AdapterInterface,
  type FlowCtxOf,
  type FrontMcpAdapterResponse,
} from '../../common';

const ToolHook = FlowHooksOf('tools:call-tool');
const ReadResourceHook = FlowHooksOf('resources:read-resource');
const GetPromptHook = FlowHooksOf('prompts:get-prompt');
const CompleteHook = FlowHooksOf('completion:complete');

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

  @CompleteHook.Will('complete')
  onComplete(ctx: FlowCtxOf<'completion:complete'>) {
    hookRuns.push(`complete:${ctx.state.prompt?.name ?? ctx.state.resource?.name}`);
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

const nestedHookRuns: string[] = [];

@Plugin({ name: 'order-maintenance-audit' })
class OrderMaintenanceAuditPlugin {
  @ToolHook.Will('execute')
  onToolCall(ctx: FlowCtxOf<'tools:call-tool'>) {
    nestedHookRuns.push(`tool:${ctx.state.tool?.name}`);
  }
}

@Plugin({ name: 'order-maintenance', plugins: [OrderArchivePlugin, OrderMaintenanceAuditPlugin] })
class OrderMaintenancePlugin {}

@Skill({ name: 'order-playbook', description: 'How to handle an order', instructions: 'Look the order up first.' })
class OrderPlaybookSkill extends SkillContext {}

@App({
  id: 'orders',
  name: 'Orders',
  tools: [ListOrdersTool],
  adapters: [OrdersApiAdapter],
  plugins: [EntryAuditPlugin, OrderExportsPlugin, OrderMaintenancePlugin],
  skills: [OrderPlaybookSkill],
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

@ResourceTemplate({ name: 'invoice-by-id', uriTemplate: 'invoices://invoice/{id}' })
class InvoiceByIdResource extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return textResource(uri);
  }
}

@App({
  id: 'billing',
  name: 'Billing',
  tools: [GetInvoiceTool],
  resources: [InvoiceFeedResource, InvoiceByIdResource],
  prompts: [InvoiceSummaryPrompt],
})
class BillingApp {}

@Prompt({ name: 'server-notes', arguments: [] })
class ServerNotesPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return textPrompt();
  }
}

@Plugin({ name: 'server-notes', prompts: [ServerNotesPrompt] })
class ServerNotesPlugin {}

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
      plugins: [ServerNotesPlugin],
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

  it('runs for a completion of a prompt provided by an adapter of the app', async () => {
    const params = { ref: { type: 'ref/prompt', name: 'order-summary' }, argument: { name: 'topic', value: '' } };

    expect(await hooksFor('completion/complete', params)).toEqual(['complete:order-summary']);
  });

  it('runs for a completion of a resource template provided by an adapter of the app', async () => {
    const params = { ref: { type: 'ref/resource', uri: 'orders://order/{id}' }, argument: { name: 'id', value: '' } };

    expect(await hooksFor('completion/complete', params)).toEqual(['complete:order-by-id']);
  });

  it('does not run for a completion of a prompt of another app', async () => {
    const params = { ref: { type: 'ref/prompt', name: 'invoice-summary' }, argument: { name: 'topic', value: '' } };

    expect(await hooksFor('completion/complete', params)).toEqual([]);
  });

  it('does not run for a completion of a resource template of another app', async () => {
    const params = {
      ref: { type: 'ref/resource', uri: 'invoices://invoice/{id}' },
      argument: { name: 'id', value: '' },
    };

    expect(await hooksFor('completion/complete', params)).toEqual([]);
  });

  it('runs for the skill:// index the server serves outside every app', async () => {
    expect(await hooksFor('resources/read', { uri: 'skill://index.json' })).toEqual(['resource:sep2640-skill-index']);
  });

  it('runs for a skill:// SKILL.md resource the server serves outside every app', async () => {
    expect(await hooksFor('resources/read', { uri: 'skill://order-playbook/SKILL.md' })).toEqual([
      'resource:order-playbook',
    ]);
  });

  it('runs for a completion of a skill:// template the server serves outside every app', async () => {
    const params = {
      ref: { type: 'ref/resource', uri: 'skill://{+skillPath}/SKILL.md' },
      argument: { name: 'skillPath', value: '' },
    };

    expect(await hooksFor('completion/complete', params)).toEqual(['complete:sep2640-skill-md']);
  });

  it('runs for a prompt a server-level plugin provides outside every app', async () => {
    expect(await hooksFor('prompts/get', { name: 'server-notes', arguments: {} })).toEqual(['prompt:server-notes']);
  });

  it('runs a hook of a plugin nested in a plugin of the app for the app tools', async () => {
    nestedHookRuns.length = 0;
    await hooksFor('tools/call', { name: 'list_orders', arguments: {} });

    expect(nestedHookRuns).toEqual(['tool:list_orders']);
  });

  it('does not run a hook of a plugin nested in a plugin of the app for a tool of another app', async () => {
    nestedHookRuns.length = 0;
    await hooksFor('tools/call', { name: 'get_invoice', arguments: {} });

    expect(nestedHookRuns).toEqual([]);
  });
});
