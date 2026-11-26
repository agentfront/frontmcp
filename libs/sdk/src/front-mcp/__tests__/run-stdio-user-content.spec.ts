/**
 * #1364: a stdio server opens no HTTP listener, so it ignores `http.userContent` and says so on stderr at startup.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm } from '@frontmcp/utils';

import { type FrontMcpConfigInput } from '../../common';

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

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the stdio shutdown never exited');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Run a stdio server in a module registry of its own (a process serves stdio once), then stop it. */
async function runStdioServer(http: FrontMcpConfigInput['http']): Promise<void> {
  const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  try {
    await jest.isolateModulesAsync(async () => {
      const { App } = require('../../common') as typeof import('../../common');
      const { FrontMcpInstance } = require('../front-mcp') as typeof import('../front-mcp');

      @App({ id: 'stdio', name: 'Stdio' })
      class StdioApp {}

      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-user-content', version: '1.0.0' },
        apps: [StdioApp],
        http,
      });
    });
    process.emit('SIGTERM');
    await until(() => exit.mock.calls.length > 0);
  } finally {
    exit.mockRestore();
  }
}

describe('runStdio with http.userContent', () => {
  const savedConsole = { ...console };
  const savedEnv = {
    FRONTMCP_STDIO: process.env['FRONTMCP_STDIO'],
    FRONTMCP_LOG_DIR: process.env['FRONTMCP_LOG_DIR'],
    FRONTMCP_LOG_LEVEL: process.env['FRONTMCP_LOG_LEVEL'],
  };
  const savedSignalListeners = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };
  let logDir: string;

  beforeEach(async () => {
    logDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-stdio-user-content-'));
    process.env['FRONTMCP_LOG_DIR'] = logDir;
    delete process.env['FRONTMCP_LOG_LEVEL'];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    Object.assign(console, savedConsole);
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal)) {
        if (!savedSignalListeners[signal].includes(listener)) process.removeListener(signal, listener);
      }
    }
    await rm(logDir, { recursive: true, force: true });
  });

  /** Everything the server wrote to stderr: its redirected console, and warnings, which go there already. */
  function captureStderr(): () => string {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    return () =>
      [...stderr.mock.calls.map(([chunk]) => String(chunk)), ...warn.mock.calls.map((call) => call.join(' '))].join(
        '\n',
      );
  }

  it('ignores it, with a startup warning on stderr', async () => {
    const stderrText = captureStderr();

    await runStdioServer({ userContent: { port: 0, root: os.tmpdir() } });

    expect(stderrText()).toContain(
      'http.userContent is ignored: a stdio server (runStdio) opens no listener of its own',
    );
    expect(stderrText()).not.toContain('User content on');
  });

  it('says nothing without it', async () => {
    const stderrText = captureStderr();

    await runStdioServer(undefined);

    expect(stderrText()).not.toContain('http.userContent');
  });
});
