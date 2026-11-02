/**
 * A stdio server whose client goes away (stdin ends, or the parent process dies) shuts down through the same
 * path as SIGTERM, providers' `onShutdown()` included, and exits 0, instead of staying alive as an orphan.
 */
import 'reflect-metadata';

import type { ProcessWatcher, WatchParentOptions } from '@frontmcp/utils';

import { App, LogLevel, Provider, type OnShutdown } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

const mockWatchers: WatchParentOptions[] = [];

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  watchParent: (options: WatchParentOptions): ProcessWatcher => {
    mockWatchers.push(options);
    return { close: () => undefined };
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

const phases: string[] = [];

@Provider({ name: 'journal' })
class Journal implements OnShutdown {
  async onShutdown() {
    phases.push('shutdown');
  }
}

@App({ id: 'orphan', name: 'Orphan', providers: [Journal] })
class OrphanApp {}

describe('runStdio when its client goes away', () => {
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

  it('watches stdin and the parent by default, and on stdin end runs the shutdown phase and exits 0', async () => {
    process.env['FRONTMCP_LOGS_MAX'] = '0';
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-orphan', version: '1.0.0' },
        apps: [OrphanApp],
        logging: { level: LogLevel.Off, enableConsole: false },
      });
      expect(mockWatchers).toHaveLength(1);
      expect(mockWatchers[0].stdin).toBe(process.stdin);

      mockWatchers[0].onGone('stdin-ended');
      const deadline = Date.now() + 5_000;
      while (exit.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(phases).toEqual(['shutdown']);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });
});
