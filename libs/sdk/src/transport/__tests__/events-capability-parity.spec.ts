/**
 * Every place that assembles server capabilities advertises events the same way, for one scope: the shared server
 * options (in-memory, Web fetch, the 2026-07-28 dispatcher), `server/discover`, the session transports' adapter, and
 * stdio. The MCP server is replaced with a stand-in that records the capabilities it is built with.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { EVENTS_EXTENSION_ID } from '@frontmcp/protocol';

import { App, event, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { LocalTransportAdapter } from '../adapters/transport.local.adapter';
import { buildScopedServerOptions } from '../build-scoped-server-options';
import { buildDiscoverCapabilities } from '../mcp-20260728/discover';

type Capabilities = Record<string, unknown>;

const mockRecordedCapabilities: Capabilities[] = [];

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class RecordingMcpServer {
    constructor(_info: unknown, options: { capabilities: Capabilities }) {
      mockRecordedCapabilities.push(options.capabilities);
    }
    setRequestHandler() {
      return undefined;
    }
    setNotificationHandler() {
      return undefined;
    }
    async connect() {
      throw new Error('capabilities recorded');
    }
    async close() {
      return undefined;
    }
  }
  class IdleStdioServerTransport {
    async close() {
      return undefined;
    }
  }
  return { ...actual, McpServer: RecordingMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

const orderCreated = event({ name: 'order.created', payloadSchema: { orderId: z.string() } });

@Tool({ name: 'place_order', inputSchema: {} })
class PlaceOrderTool extends ToolContext {
  async execute() {
    return { placed: true };
  }
}

@App({ id: 'shop', name: 'Shop', tools: [PlaceOrderTool], events: [orderCreated] })
class ShopApp {}

const serverConfig = {
  info: { name: 'events-capability-parity', version: '1.0.0' },
  apps: [ShopApp],
  logging: { level: LogLevel.Off, enableConsole: false },
  events: { poll: { enabled: false } },
};

function lastRecordedCapabilities(): Capabilities {
  const capabilities = mockRecordedCapabilities.pop();
  if (!capabilities) throw new Error('no MCP server was built');
  return capabilities;
}

async function sessionAdapterCapabilities(scope: Scope): Promise<Capabilities> {
  const sessionId = 'events-capability-parity';
  const adapter = Object.create(LocalTransportAdapter.prototype) as { connectServer(): Promise<void> };
  Object.assign(adapter, { scope, logger: scope.logger, key: { sessionId }, transport: {} });
  await expect(adapter.connectServer()).rejects.toThrow('capabilities recorded');
  scope.notifications.unregisterServer(sessionId);
  return lastRecordedCapabilities();
}

async function stdioCapabilities(scope: Scope): Promise<Capabilities> {
  const primaryScope = jest.spyOn(FrontMcpInstance.prototype, 'getPrimaryScope').mockReturnValue(scope);
  try {
    await expect(FrontMcpInstance.runStdio(serverConfig)).rejects.toThrow('capabilities recorded');
  } finally {
    primaryScope.mockRestore();
  }
  return lastRecordedCapabilities();
}

async function capabilitiesOfEveryPath(scope: Scope): Promise<Record<string, Capabilities>> {
  return {
    'shared server options': buildScopedServerOptions(scope).capabilities,
    'server/discover': buildDiscoverCapabilities(scope) as Capabilities,
    'session transport adapter': await sessionAdapterCapabilities(scope),
    stdio: await stdioCapabilities(scope),
  };
}

describe('events capability', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  let scope: Scope;

  beforeAll(async () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const instance = await FrontMcpInstance.createForGraph(serverConfig);
    scope = instance.getScopes()[0] as Scope;
  });

  afterAll(async () => {
    await scope.dispose();
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
    else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
    else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
  });

  it('is advertised by no assembly path while no delivery mode is enabled', async () => {
    const paths = await capabilitiesOfEveryPath(scope);

    expect(Object.keys(paths)).toHaveLength(4);
    for (const [path, capabilities] of Object.entries(paths)) {
      expect({ path, events: capabilities['events'] }).toEqual({ path, events: undefined });
      expect({ path, extensions: capabilities['extensions'] ?? {} }).not.toEqual({
        path,
        extensions: expect.objectContaining({ [EVENTS_EXTENSION_ID]: expect.anything() }),
      });
      expect(capabilities['tools']).toBeDefined();
    }
  });

  it('is advertised top-level and as the SEP-3415 extension by every assembly path once a mode is enabled', async () => {
    scope.events?.enableDeliveryMode('webhook');

    const paths = await capabilitiesOfEveryPath(scope);

    for (const [path, capabilities] of Object.entries(paths)) {
      expect({ path, events: capabilities['events'] }).toEqual({ path, events: {} });
      expect({ path, extension: (capabilities['extensions'] as Capabilities)[EVENTS_EXTENSION_ID] }).toEqual({
        path,
        extension: {},
      });
      expect(capabilities['tools']).toBeDefined();
    }
  });
});
