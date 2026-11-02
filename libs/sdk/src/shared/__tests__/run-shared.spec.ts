import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { InvalidSharedServerOptionsError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { exitOnShutdownSignals } from '../../front-mcp/shutdown-signals';
import { redirectConsoleToStderr } from '../../front-mcp/stdio-console';
import { SHARED_SERVE_ENV } from '../ensure-shared-server';
import { attachSharedSession } from '../shared-attach';
import { sharedServerFiles } from '../shared-files';

jest.mock('../../front-mcp/shutdown-signals', () => ({
  ...jest.requireActual('../../front-mcp/shutdown-signals'),
  exitOnShutdownSignals: jest.fn(() => () => undefined),
}));
jest.mock('../../front-mcp/stdio-console', () => ({ redirectConsoleToStderr: jest.fn() }));
jest.mock('../shared-attach', () => ({ attachSharedSession: jest.fn() }));

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'run', name: 'Run', tools: [PingTool] })
class RunApp {}

const config = {
  info: { name: 'run-shared-spec', version: '1.0.0' },
  apps: [RunApp],
  logging: { level: LogLevel.Off, enableConsole: false },
};

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('FrontMcpInstance.runShared', () => {
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-run-shared-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
  });

  afterEach(() => {
    delete process.env[SHARED_SERVE_ENV];
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('refuses invalid options before it attaches to or starts anything', async () => {
    await expect(FrontMcpInstance.runShared(config, { key: '../x' })).rejects.toThrow(InvalidSharedServerOptionsError);
    expect(attachSharedSession).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, 'shared'))).toBe(false);
  });

  it('serves the key in the process a session started, which keeps the key out of its own children', async () => {
    process.env[SHARED_SERVE_ENV] = 'run';
    await FrontMcpInstance.runShared(config, { key: 'run', transport: 'http' });

    expect(process.env[SHARED_SERVE_ENV]).toBeUndefined();
    expect(attachSharedSession).not.toHaveBeenCalled();
    const files = sharedServerFiles('run');
    expect(fs.existsSync(files.recordFile)).toBe(true);

    const [[close]] = jest.mocked(exitOnShutdownSignals).mock.calls;
    await close('signal');
    expect(fs.existsSync(files.recordFile)).toBe(false);
  });

  it('attaches stdio to the key everywhere else, and stops the session when the client goes away', async () => {
    const stop = jest.fn(async () => undefined);
    jest.mocked(attachSharedSession).mockReturnValue({ attached: Promise.resolve(), stop });
    process.env[SHARED_SERVE_ENV] = 'another-key';

    await FrontMcpInstance.runShared(config, { key: 'run' });

    expect(redirectConsoleToStderr).toHaveBeenCalled();
    expect(attachSharedSession).toHaveBeenCalledWith({
      key: 'run',
      transport: 'unix',
      input: process.stdin,
      output: process.stdout,
    });
    const [[shutdown, options]] = jest.mocked(exitOnShutdownSignals).mock.calls;
    expect(options).toMatchObject({ whenOrphaned: { stdin: process.stdin } });
    await shutdown('stdin-ended');
    expect(stop).toHaveBeenCalled();
  });

  it('fails when the session can not reach its server', async () => {
    const attached = Promise.reject(new Error('no server'));
    attached.catch(() => undefined);
    jest.mocked(attachSharedSession).mockReturnValue({ attached, stop: jest.fn(async () => undefined) });

    await expect(FrontMcpInstance.runShared(config, { key: 'run' })).rejects.toThrow('no server');
  });
});
