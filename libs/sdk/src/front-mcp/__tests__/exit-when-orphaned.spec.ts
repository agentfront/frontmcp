/**
 * `lifecycle.exitWhenOrphaned`: the shutdown helper watches the parent (and stdin, when given); `runStdio()` watches
 * by default and can opt out, the HTTP and Unix socket servers watch only when asked.
 */
import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';

import { randomUUID, type ProcessWatcher, type WatchParentOptions } from '@frontmcp/utils';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../front-mcp';
import { exitOnShutdownSignals } from '../shutdown-signals';

const mockWatchers: Array<{ options: WatchParentOptions; close: jest.Mock }> = [];

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  watchParent: (options: WatchParentOptions): ProcessWatcher => {
    const close = jest.fn();
    mockWatchers.push({ options, close });
    return { close };
  },
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

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'demo', name: 'Demo', tools: [PingTool] })
class DemoApp {}

class FakeProcess extends EventEmitter {
  readonly exit = jest.fn();
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const signalsBefore = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };

function removeAddedSignalListeners(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalsBefore[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
}

beforeEach(() => {
  mockWatchers.length = 0;
});

describe('exitOnShutdownSignals({ whenOrphaned })', () => {
  it.each(['stdin-ended', 'parent-exited'] as const)(
    'shuts down once and exits 0 when the watcher reports %s',
    async (reason) => {
      const target = new FakeProcess();
      const stdin = new PassThrough();
      const shutdown = jest.fn().mockResolvedValue(undefined);
      const logger = { error: jest.fn(), info: jest.fn() };
      exitOnShutdownSignals(shutdown, { target, logger, whenOrphaned: { stdin } });
      expect(mockWatchers[0].options.stdin).toBe(stdin);

      mockWatchers[0].options.onGone(reason);
      target.emit('SIGTERM');
      await flush();

      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(target.exit).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('shutting down'));
    },
  );

  it('watches nothing unless asked, and stops watching when removed', () => {
    const target = new FakeProcess();
    exitOnShutdownSignals(jest.fn(), { target });
    expect(mockWatchers).toHaveLength(0);

    const remove = exitOnShutdownSignals(jest.fn(), { target, whenOrphaned: {} });
    remove();

    expect(mockWatchers[0].options.stdin).toBeUndefined();
    expect(mockWatchers[0].close).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle.exitWhenOrphaned', () => {
  it('accepts a boolean and refuses anything else', () => {
    expect(
      frontMcpMetadataSchema.parse({
        info: { name: 'x', version: '1' },
        apps: [DemoApp],
        lifecycle: { exitWhenOrphaned: false },
      }).lifecycle,
    ).toEqual({ exitWhenOrphaned: false });
    expect(() =>
      frontMcpMetadataSchema.parse({
        info: { name: 'x', version: '1' },
        apps: [DemoApp],
        lifecycle: { exitWhenOrphaned: 'yes' },
      }),
    ).toThrow('lifecycle.exitWhenOrphaned must be true or false');
  });

  it('turns the stdio watch off when false', async () => {
    const savedConsole = { ...console };
    const savedStdioEnv = process.env['FRONTMCP_STDIO'];
    const savedLogsMax = process.env['FRONTMCP_LOGS_MAX'];
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-attached', version: '1.0.0' },
        apps: [DemoApp],
        logging: { level: LogLevel.Off, enableConsole: false },
        lifecycle: { exitWhenOrphaned: false },
      });
      expect(mockWatchers).toHaveLength(0);
    } finally {
      exit.mockRestore();
      Object.assign(console, savedConsole);
      if (savedStdioEnv === undefined) delete process.env['FRONTMCP_STDIO'];
      else process.env['FRONTMCP_STDIO'] = savedStdioEnv;
      if (savedLogsMax === undefined) delete process.env['FRONTMCP_LOGS_MAX'];
      else process.env['FRONTMCP_LOGS_MAX'] = savedLogsMax;
      removeAddedSignalListeners();
    }
  });

  it.each([
    [undefined, 0],
    [true, 1],
  ])('watches the parent of a Unix socket server only when asked (%p)', async (exitWhenOrphaned, watchers) => {
    const handle = await FrontMcpInstance.runUnixSocket({
      info: { name: 'socket-orphan', version: '1.0.0' },
      apps: [DemoApp],
      logging: { level: LogLevel.Off },
      socketPath: path.join(os.tmpdir(), `fmcp-${randomUUID().slice(0, 8)}.sock`),
      ...(exitWhenOrphaned === undefined ? {} : { lifecycle: { exitWhenOrphaned } }),
    });
    try {
      expect(mockWatchers).toHaveLength(watchers);
      if (watchers) expect(mockWatchers[0].options.stdin).toBeUndefined();
    } finally {
      await handle.close();
    }
  });

  it('watches the parent of the HTTP server when asked', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let instance: FrontMcpInstance | undefined;
    try {
      instance = await FrontMcpInstance.bootstrap({
        info: { name: 'http-orphan', version: '1.0.0' },
        apps: [DemoApp],
        logging: { level: LogLevel.Off },
        http: { port: 0 },
        lifecycle: { exitWhenOrphaned: true },
      });
      expect(mockWatchers).toHaveLength(1);
      expect(mockWatchers[0].options.stdin).toBeUndefined();
    } finally {
      await instance?.shutdown();
      removeAddedSignalListeners();
      log.mockRestore();
    }
  });
});
