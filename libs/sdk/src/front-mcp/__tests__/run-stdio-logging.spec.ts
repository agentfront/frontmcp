/**
 * A stdio server writes its log lines to stderr and to its log file, never to stdout, which carries the JSON-RPC
 * frames. Without a `logging` option it wrote no line at all: `runStdio()` built the option itself, with no level.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, readdir, readFile, rm } from '@frontmcp/utils';

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

const START_LINE = 'Initializing FrontMCP "stdio-logging v1.0.0"';

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('the stdio shutdown never exited');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Run a stdio server in a module registry of its own (a process serves stdio once), then stop it. */
async function runStdioServer(logging: FrontMcpConfigInput['logging']): Promise<void> {
  const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  try {
    await jest.isolateModulesAsync(async () => {
      const { App } = require('../../common') as typeof import('../../common');
      const { FrontMcpInstance } = require('../front-mcp') as typeof import('../front-mcp');

      @App({ id: 'stdio', name: 'Stdio' })
      class StdioApp {}

      await FrontMcpInstance.runStdio({
        info: { name: 'stdio-logging', version: '1.0.0' },
        apps: [StdioApp],
        ...(logging ? { logging } : {}),
      });
    });
    process.emit('SIGTERM');
    await until(() => exit.mock.calls.length > 0);
  } finally {
    exit.mockRestore();
  }
}

describe('runStdio logging', () => {
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
    logDir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-stdio-logging-'));
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

  async function logFileText(): Promise<string> {
    const fileNames = await readdir(logDir);
    const files = await Promise.all(fileNames.map((fileName) => readFile(path.join(logDir, fileName))));
    return files.join('');
  }

  it.each<[string, FrontMcpConfigInput['logging']]>([
    ['no logging option', undefined],
    ['logging: {}', {}],
  ])('writes its log lines to stderr and to its log file with %s, and nothing to stdout', async (_label, logging) => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runStdioServer(logging);

    const stderrText = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(stderrText).toContain(START_LINE);
    expect(await logFileText()).toContain(START_LINE);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('takes its level from FRONTMCP_LOG_LEVEL with no logging option', async () => {
    process.env['FRONTMCP_LOG_LEVEL'] = 'error';
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runStdioServer(undefined);

    expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain(START_LINE);
    expect(await logFileText()).not.toContain(START_LINE);
  });
});
