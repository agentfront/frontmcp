import 'reflect-metadata';

import { App, LogLevel, Provider, type OnReady, type OnShutdown } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class IdleMcpServer {
    setRequestHandler() {
      // handlers are not under test
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
  return { ...actual, McpServer: IdleMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

const phases: string[] = [];

@Provider({ name: 'stdio-pool' })
class StdioPool implements OnReady, OnShutdown {
  onReady() {
    phases.push('ready');
  }
  async onShutdown() {
    phases.push('shutdown');
  }
}

@App({ id: 'stdio', name: 'Stdio', providers: [StdioPool] })
class StdioApp {}

describe('runStdio provider lifecycle', () => {
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

  it('readies the providers once stdio is connected, and shuts them down on SIGTERM', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-lifecycle', version: '1.0.0' },
        apps: [StdioApp],
        logging: { level: LogLevel.Off, enableConsole: false },
      });
      expect(phases).toEqual(['ready']);

      process.emit('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(phases).toEqual(['ready', 'shutdown']);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });
});
