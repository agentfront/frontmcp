/**
 * `createDirect`, `createFetchHandler` and `connect` serve the server's own apps.
 *
 * A `standalone: true` app (such as `DashboardApp`) gets a scope of its own, created before the
 * scope holding the server's other apps. These entry points served "the first scope", so with a
 * standalone app in `apps` they served that app's tools instead of the server's: the server's
 * tools were missing, and the standalone app's were reachable without the route (and any gate on
 * it) the Node server puts in front of them.
 */
import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { clearScopeCache, connect } from '../../direct/connect';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'list_orders', inputSchema: {} })
class ListOrdersTool extends ToolContext {
  async execute() {
    return { orders: [] };
  }
}

@Tool({ name: 'ops_console', inputSchema: {} })
class OpsConsoleTool extends ToolContext {
  async execute() {
    return { console: 'open' };
  }
}

@App({ id: 'ops', name: 'Ops', standalone: true, tools: [OpsConsoleTool] })
class OpsApp {}

@App({ id: 'orders', name: 'Orders', tools: [ListOrdersTool] })
class OrdersApp {}

const splitConfig: FrontMcpConfigInput = { ...config([OrdersApp, OpsApp]), splitByApp: true };

function config(apps: FrontMcpConfigInput['apps']): FrontMcpConfigInput {
  return { info: { name: 'primary-scope', version: '1.0.0' }, apps, logging: { level: LogLevel.Off } };
}

async function directToolNames(apps: FrontMcpConfigInput['apps']): Promise<string[]> {
  const server = await FrontMcpInstance.createDirect(config(apps));
  try {
    const { tools } = await server.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await server.dispose();
  }
}

async function fetchToolNames(apps: FrontMcpConfigInput['apps'], path = '/'): Promise<string[]> {
  const handler = await FrontMcpInstance.createFetchHandler(config(apps));
  const response = await handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_2026_07_28,
        'mcp-method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: { name: 'primary-scope-spec', version: '1.0.0' },
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      }),
    }),
  );
  const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
  return (body.result?.tools ?? []).map((tool) => tool.name);
}

async function connectToolNames(apps: FrontMcpConfigInput['apps']): Promise<string[]> {
  const client = await connect(config(apps));
  try {
    const tools = (await client.listTools()) as Array<{ name: string }>;
    return tools.map((tool) => tool.name);
  } finally {
    await client.close();
    clearScopeCache();
  }
}

describe.each([
  ['createDirect', directToolNames],
  ['createFetchHandler', fetchToolNames],
  ['connect', connectToolNames],
])('%s', (_entryPoint, toolNames) => {
  it("serves the server's apps when a standalone app is listed first", async () => {
    const names = await toolNames([OpsApp, OrdersApp]);

    expect(names).toContain('list_orders');
    expect(names).not.toContain('ops_console');
  });

  it("serves the server's apps when a standalone app is listed last", async () => {
    const names = await toolNames([OrdersApp, OpsApp]);

    expect(names).toContain('list_orders');
    expect(names).not.toContain('ops_console');
  });
});

describe.each([
  ['createDirect', directToolNames],
  ['connect', connectToolNames],
])('%s', (_entryPoint, toolNames) => {
  it('still serves a standalone app that is the only app', async () => {
    expect(await toolNames([OpsApp])).toContain('ops_console');
  });
});

describe('createFetchHandler with a standalone app that is the only app', () => {
  it('serves it at its own path only, as the Node server does', async () => {
    expect(await fetchToolNames([OpsApp], '/ops')).toEqual(['ops_console']);
    expect(await fetchToolNames([OpsApp])).toEqual([]);
  });
});

describe('reaching an app with an endpoint of its own in-process', () => {
  it.each([
    ['orders', 'list_orders'],
    ['ops', 'ops_console'],
  ])('createDirect({ app: "%s" }) serves that app of a splitByApp server', async (app, toolName) => {
    const server = await FrontMcpInstance.createDirect(splitConfig, { app });
    const { tools } = await server.listTools();
    await server.dispose();

    expect(tools.map((tool) => tool.name)).toEqual([toolName]);
  });

  it.each([
    ['orders', 'list_orders'],
    ['ops', 'ops_console'],
  ])('connect({ app: "%s" }) connects to that app of a splitByApp server', async (app, toolName) => {
    const client = await connect(splitConfig, { app });
    const tools = (await client.listTools()) as Array<{ name: string }>;
    await client.close();

    expect(tools.map((tool) => tool.name)).toEqual([toolName]);
  });

  it("reaches a standalone app's own endpoint next to the server's", async () => {
    const shared = config([OrdersApp, OpsApp]);
    const ops = await connect(shared, { app: 'ops' });
    const main = await connect(shared);
    const opsTools = (await ops.listTools()) as Array<{ name: string }>;
    const mainTools = (await main.listTools()) as Array<{ name: string }>;
    await ops.close();
    await main.close();

    expect(opsTools.map((tool) => tool.name)).toEqual(['ops_console']);
    expect(mainTools.map((tool) => tool.name)).toEqual(['list_orders']);
  });

  it('refuses an app without an endpoint of its own, naming the ones that have one', async () => {
    await expect(FrontMcpInstance.createDirect(config([OrdersApp, OpsApp]), { app: 'orders' })).rejects.toThrow(
      'No endpoint serves app "orders" on its own. Apps with an endpoint of their own (splitByApp or standalone): "ops"',
    );
  });
});
