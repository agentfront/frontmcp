/**
 * A stdio start that fails after its scopes are live rolls them back within the stdio shutdown deadline:
 * an `onDispose` callback that never settles cannot hold back the start error.
 */
import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../front-mcp';
import { STDIO_SHUTDOWN_DEADLINE_MS } from '../shutdown-signals';

jest.mock('@frontmcp/protocol', () => {
  const actual = jest.requireActual('@frontmcp/protocol');
  class RefusingMcpServer {
    setRequestHandler() {
      return undefined;
    }
    setNotificationHandler() {
      return undefined;
    }
    async connect() {
      throw new Error('connect refused');
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
  return { ...actual, McpServer: RefusingMcpServer, StdioServerTransport: IdleStdioServerTransport };
});

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'rollback', name: 'Rollback', tools: [NoopTool] })
class RollbackApp {}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('runStdio startup rollback deadline', () => {
  const savedConsole = { ...console };
  const savedStdioEnv = process.env['FRONTMCP_STDIO'];
  const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];

  afterAll(() => {
    jest.useRealTimers();
    Object.assign(console, savedConsole);
    if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
    else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
    if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
    else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
  });

  it('rejects with the start error at the deadline when an onDispose callback hangs', async () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    let entered = false;
    const getPrimaryScope = FrontMcpInstance.prototype.getPrimaryScope;
    const capture = jest.spyOn(FrontMcpInstance.prototype, 'getPrimaryScope').mockImplementation(function (
      this: FrontMcpInstance,
    ) {
      const scope = getPrimaryScope.call(this);
      scope?.onDispose(
        () =>
          new Promise<void>(() => {
            entered = true;
          }),
      );
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
      return scope;
    });
    try {
      let outcome: unknown;
      const run = FrontMcpInstance.runStdio({
        info: { name: 'stdio-rollback', version: '1.0.0' },
        apps: [RollbackApp],
        logging: { level: LogLevel.Off, enableConsole: false },
      }).catch((error: unknown) => {
        outcome = error;
      });

      for (let i = 0; i < 200 && !entered; i++) await flush();
      expect(entered).toBe(true);
      jest.advanceTimersByTime(STDIO_SHUTDOWN_DEADLINE_MS - 1);
      await flush();
      expect(outcome).toBeUndefined();
      jest.advanceTimersByTime(1);
      for (let i = 0; i < 20 && outcome === undefined; i++) await flush();

      expect(outcome).toEqual(new Error('connect refused'));
      await run;
    } finally {
      capture.mockRestore();
      jest.useRealTimers();
    }
  });
});
