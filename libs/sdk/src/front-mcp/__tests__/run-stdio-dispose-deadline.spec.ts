/**
 * An `onDispose` callback that never settles cannot keep a stdio server alive: the process exits 1
 * once the stdio shutdown deadline passes, as the HTTP and socket servers do.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext, type ScopeEntry } from '../../common';
import { FrontMcpInstance } from '../front-mcp';
import { STDIO_SHUTDOWN_DEADLINE_MS } from '../shutdown-signals';

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

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'hang', name: 'Hang', tools: [NoopTool] })
class HangApp {}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('runStdio shutdown deadline', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
  const signalsBefore = process.listeners('SIGTERM');

  afterAll(() => {
    jest.useRealTimers();
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

  it('exits 1 at the deadline when an onDispose callback hangs', async () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const getPrimaryScope = FrontMcpInstance.prototype.getPrimaryScope;
    let scope: ScopeEntry | undefined;
    const capture = jest.spyOn(FrontMcpInstance.prototype, 'getPrimaryScope').mockImplementation(function (
      this: FrontMcpInstance,
    ) {
      scope = getPrimaryScope.call(this);
      return scope;
    });
    try {
      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-hang', version: '1.0.0' },
        apps: [HangApp],
        logging: { level: LogLevel.Off, enableConsole: false },
      });
      capture.mockRestore();
      if (!scope) throw new Error('runStdio served no scope');
      let entered = false;
      scope.onDispose(
        () =>
          new Promise<void>(() => {
            entered = true;
          }),
      );
      const onSigterm = process.listeners('SIGTERM').find((listener) => !signalsBefore.includes(listener));
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });

      onSigterm?.('SIGTERM');
      for (let i = 0; i < 100 && !entered; i++) await flush();
      expect(entered).toBe(true);
      jest.advanceTimersByTime(STDIO_SHUTDOWN_DEADLINE_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);

      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
    }
  });
});
