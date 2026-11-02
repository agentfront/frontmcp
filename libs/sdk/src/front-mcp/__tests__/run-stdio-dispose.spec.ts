/**
 * `runStdio` shuts down like the HTTP and socket servers: SIGTERM/SIGINT shut every scope down and
 * then dispose it, so `scope.onDispose()` callbacks run under stdio too. They never did: the stdio
 * handler called `scope.shutdown()` and exited.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext, type ScopeEntry } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

const mockServerClose = jest.fn();

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
      mockServerClose();
    }
  }
  class IdleStdioServerTransport {
    async close() {
      return undefined;
    }
  }
  return { ...actual, McpServer: IdleMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'dispose', name: 'Dispose', tools: [NoopTool] })
class DisposeApp {}

describe('runStdio shutdown', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  const signalsBefore = process.listeners('SIGTERM');
  let exit: jest.SpyInstance;

  beforeAll(() => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterAll(() => {
    exit.mockRestore();
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
    else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
    else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!signalsBefore.includes(listener)) process.removeListener(signal, listener);
      }
    }
  });

  it('awaits every onDispose callback on SIGTERM, then closes the server and exits 0', async () => {
    const getPrimaryScope = FrontMcpInstance.prototype.getPrimaryScope;
    let scope: ScopeEntry | undefined;
    const capture = jest.spyOn(FrontMcpInstance.prototype, 'getPrimaryScope').mockImplementation(function (
      this: FrontMcpInstance,
    ) {
      scope = getPrimaryScope.call(this);
      return scope;
    });
    await FrontMcpInstance.runStdio({
      info: { name: 'stdio-dispose', version: '1.0.0' },
      apps: [DisposeApp],
      logging: { level: LogLevel.Off, enableConsole: false },
    });
    capture.mockRestore();
    if (!scope) throw new Error('runStdio served no scope');

    const order: string[] = [];
    scope.onDispose(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push('slow');
    });
    scope.onDispose(() => {
      order.push('fast');
    });
    const onSigterm = process.listeners('SIGTERM').find((listener) => !signalsBefore.includes(listener));

    onSigterm?.('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (exit.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(order).toEqual(['fast', 'slow']);
    expect(mockServerClose).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
