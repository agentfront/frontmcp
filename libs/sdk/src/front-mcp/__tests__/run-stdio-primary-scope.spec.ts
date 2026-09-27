/**
 * `runStdio` serves the server's own apps, not a standalone app's scope.
 *
 * A `standalone: true` app (such as `DashboardApp`) gets a scope of its own, created before the
 * scope holding the server's other apps, and `runStdio` served "the first scope": with a
 * standalone app in `apps`, a stdio client saw that app's tools instead of the server's.
 *
 * The stdio transport and MCP server are replaced with stand-ins that record the request
 * handlers `runStdio` registers, so the test drives `tools/list` through the same handlers a stdio
 * client reaches, without taking over the test runner's stdin/stdout.
 */
import 'reflect-metadata';

import { ListToolsRequestSchema } from '@frontmcp/protocol';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

type RecordedHandler = (request: unknown, ctx: Record<string, unknown>) => Promise<unknown>;

const mockHandlers = new Map<unknown, RecordedHandler>();

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class RecordingMcpServer {
    setRequestHandler(schema: unknown, handler: RecordedHandler) {
      mockHandlers.set(schema, handler);
    }
    setNotificationHandler() {
      // notifications are not under test
    }
    async connect() {
      // no transport to start
    }
    async close() {
      // nothing to close
    }
  }
  class IdleStdioServerTransport {
    async close() {
      // nothing to close
    }
  }
  return { ...actual, McpServer: RecordingMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

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

describe('runStdio with a standalone app in apps', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  const savedSignalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };

  // runStdio adds a file log transport; keep it from writing under the user's home directory.
  beforeAll(() => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
  });

  afterAll(() => {
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
    else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
    else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!savedSignalListeners[signal].includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  it("lists the server's tools, not the standalone app's", async () => {
    await FrontMcpInstance.runStdio({
      info: { name: 'primary-scope-stdio', version: '1.0.0' },
      apps: [OpsApp, OrdersApp],
      logging: { level: LogLevel.Off, enableConsole: false },
    });

    const listTools = mockHandlers.get(ListToolsRequestSchema);
    if (!listTools) throw new Error('runStdio registered no tools/list handler');
    const result = (await listTools({ method: 'tools/list', params: {} }, {})) as { tools: Array<{ name: string }> };
    const names = result.tools.map((tool) => tool.name);

    expect(names).toContain('list_orders');
    expect(names).not.toContain('ops_console');
  });
});
