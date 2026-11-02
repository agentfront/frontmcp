/**
 * Only a server that listens loads the Streamable HTTP transport ahead of its first session (#951). A serverless
 * handler, a fetch handler and a stdio server never listen, so their first session loads it, as before.
 */
import 'reflect-metadata';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpServerInstance } from '../../server/server.instance';
import { loadStreamableHttpTransport } from '../../transport/adapters/transport.streamable-http.adapter';
import { FrontMcpInstance } from '../front-mcp';

jest.mock('../../transport/adapters/transport.streamable-http.adapter', () => ({
  ...jest.requireActual('../../transport/adapters/transport.streamable-http.adapter'),
  loadStreamableHttpTransport: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class IdleMcpServer {
    setRequestHandler() {
      return undefined;
    }
    setNotificationHandler() {
      return undefined;
    }
    async connect() {
      return undefined;
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
  return { ...actual, McpServer: IdleMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

const loadTransport = loadStreamableHttpTransport as jest.MockedFunction<typeof loadStreamableHttpTransport>;
const flushImmediates = () => new Promise((resolve) => setImmediate(resolve));

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'ping', name: 'Ping', tools: [PingTool] })
class PingApp {}

const config = (name: string) => ({
  info: { name, version: '1.0.0' },
  apps: [PingApp],
  logging: { level: LogLevel.Off, enableConsole: false },
});

describe('loading the Streamable HTTP transport ahead of the first session', () => {
  const savedSentinel = process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'];

  beforeEach(() => loadTransport.mockClear());

  afterAll(() => {
    if (savedSentinel === undefined) delete process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'];
    else process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = savedSentinel;
  });

  it('happens after a listening server has started and reported ready', async () => {
    process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = '1';
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(config('listening')));
    await instance.ready;
    await flushImmediates();
    expect(loadTransport).not.toHaveBeenCalled();
    const start = jest.spyOn(FrontMcpServerInstance.prototype, 'start').mockResolvedValue(undefined);
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await instance.start();
      expect(write).toHaveBeenCalledWith(expect.stringContaining('__FRONTMCP_BOOTSTRAP_COMPLETE__'));
      expect(loadTransport).not.toHaveBeenCalled();

      await flushImmediates();
      expect(loadTransport).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
      start.mockRestore();
    }
  });

  it('does not happen for a serverless handler', async () => {
    await FrontMcpInstance.createHandler(config('serverless'));
    await flushImmediates();
    expect(loadTransport).not.toHaveBeenCalled();
  });

  it('does not happen for a fetch handler', async () => {
    const handler = await FrontMcpInstance.createFetchHandler(config('fetch'));
    expect((await handler(new Request('https://example.com/healthz'))).status).toBe(200);
    await flushImmediates();
    expect(loadTransport).not.toHaveBeenCalled();
  });

  describe('for a stdio server', () => {
    const savedConsole = { ...console };
    const savedStdioEnv = process.env['FRONTMCP_STDIO'];
    const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
    const signalsBefore = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };

    afterAll(() => {
      Object.assign(console, savedConsole);
      if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
      else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
      if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
      else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        for (const listener of process.listeners(signal)) {
          if (!signalsBefore[signal].includes(listener)) process.removeListener(signal, listener);
        }
      }
    });

    it('does not happen', async () => {
      process.env['FRONTMCP_LOGS_MAX'] = '0';
      await FrontMcpInstance.runStdio(config('stdio'));
      await flushImmediates();
      expect(loadTransport).not.toHaveBeenCalled();
    });
  });
});
