import 'reflect-metadata';

import { MCP_20260728_META, PROTOCOL_2026_07_28, type JSONRPCMessage, type Transport } from '@frontmcp/protocol';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { StdioRevisionRouter } from '../../transport/stdio-revision-router';
import { FrontMcpInstance } from '../front-mcp';

const mockConnected: Transport[] = [];
const mockWritten: JSONRPCMessage[] = [];
const mockStdio: Array<{ onmessage?: Transport['onmessage'] }> = [];

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class RecordingMcpServer {
    setRequestHandler() {
      return undefined;
    }
    setNotificationHandler() {
      return undefined;
    }
    async connect(transport: Transport) {
      mockConnected.push(transport);
    }
    async close() {
      return undefined;
    }
  }
  class RecordingStdioServerTransport {
    onmessage?: Transport['onmessage'];
    constructor() {
      mockStdio.push(this);
    }
    async start() {
      return undefined;
    }
    async send(message: JSONRPCMessage) {
      mockWritten.push(message);
    }
    async close() {
      return undefined;
    }
  }
  return { ...actual, McpServer: RecordingMcpServer, StdioServerTransport: RecordingStdioServerTransport };
});

@Tool({ name: 'ping_back', inputSchema: {} })
class PingBackTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'echo', name: 'Echo', tools: [PingBackTool] })
class EchoApp {}

describe('runStdio', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  const savedSignalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };

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

  it('connects the session-era server through a router that answers 2026-07-28 messages', async () => {
    await FrontMcpInstance.runStdio({
      info: { name: 'stdio-router-wiring', version: '1.0.0' },
      apps: [EchoApp],
      logging: { level: LogLevel.Off, enableConsole: false },
    });

    const [router] = mockConnected;
    expect(router).toBeInstanceOf(StdioRevisionRouter);

    await router.start();
    mockStdio[0]?.onmessage?.({
      jsonrpc: '2.0',
      id: 'discover-1',
      method: 'server/discover',
      params: {
        _meta: {
          [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
          [MCP_20260728_META.clientCapabilities]: {},
        },
      },
    });
    const deadline = Date.now() + 5_000;
    while (mockWritten.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(mockWritten[0]).toMatchObject({
      id: 'discover-1',
      result: {
        resultType: 'complete',
        _meta: { [MCP_20260728_META.serverInfo]: { name: 'stdio-router-wiring', version: '1.0.0' } },
      },
    });
  });
});
