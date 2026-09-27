/**
 * With `DashboardApp` in `apps`, `createDirect`, `createFetchHandler`, `connect` and stdio serve the
 * server's own tools.
 *
 * `DashboardApp` is a standalone app, so it gets a scope of its own, created before the scope that
 * holds the server's other apps. These entry points served "the first scope", which was the
 * dashboard's: a client saw `dashboard:graph`, `dashboard:list-tools` and
 * `dashboard:list-resources` (the whole server's inventory) instead of the server's tools. The Node
 * server was not affected: it routes `/dashboard` to the dashboard's scope, behind its token.
 */
import 'reflect-metadata';

import { App, connect, FrontMcpInstance, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '@frontmcp/sdk';

import { DashboardApp } from '../app/dashboard.app';
import { resetDashboardOptions } from '../dashboard.config-store';
import DashboardPlugin from '../dashboard.plugin';

const CANARY = 'export_revenue_canary';
const PROTOCOL = '2026-07-28';

@Tool({ name: CANARY, description: 'Internal revenue export', inputSchema: {} })
class CanaryTool extends ToolContext {
  async execute() {
    return 'ok';
  }
}

@App({ id: 'lab', name: 'Lab', tools: [CanaryTool] })
class LabApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'inventory', version: '1.0.0' },
  apps: [LabApp, DashboardApp],
  // The config type names plugin classes; an `init()` result is accepted at run time.
  plugins: [DashboardPlugin.init({ enabled: true })] as unknown[] as FrontMcpConfigInput['plugins'],
  logging: { level: LogLevel.Off, enableConsole: false },
};

afterEach(() => resetDashboardOptions());

function expectServerTools(names: string[]): void {
  expect(names).toContain(CANARY);
  expect(names.filter((name) => name.startsWith('dashboard:'))).toEqual([]);
}

describe('entry points with DashboardApp in apps', () => {
  it('createDirect lists the server tools', async () => {
    const server = await FrontMcpInstance.createDirect(config);
    try {
      const { tools } = await server.listTools();
      expectServerTools(tools.map((tool) => tool.name));
      await expect(server.callTool('dashboard:graph', {})).rejects.toThrow();
    } finally {
      await server.dispose();
    }
  });

  it('createFetchHandler lists the server tools', async () => {
    const handler = await FrontMcpInstance.createFetchHandler(config);
    const response = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL,
          'mcp-method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': PROTOCOL,
              'io.modelcontextprotocol/clientInfo': { name: 'dashboard-spec', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    );
    const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };

    expectServerTools((body.result?.tools ?? []).map((tool) => tool.name));
  });

  it('connect lists the server tools', async () => {
    const client = await connect(config);
    try {
      const tools = (await client.listTools()) as Array<{ name: string }>;
      expectServerTools(tools.map((tool) => tool.name));
    } finally {
      await client.close();
    }
  });
});
