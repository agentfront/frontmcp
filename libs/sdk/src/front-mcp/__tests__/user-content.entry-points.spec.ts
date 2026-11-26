/**
 * #1364: the entries that open no listener of their own (serverless, fetch) ignore `http.userContent` and say so at
 * startup. A Node HTTP server opens the second listener beside MCP and closes both at shutdown: that runs on real
 * ports in apps/e2e/demo-e2e-standalone/e2e/user-content-listener.e2e.spec.ts.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const IGNORED = 'http.userContent is ignored';

describe('http.userContent on each entry point', () => {
  let root: string;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fmcp-uc-entry-'));
    await writeFile(path.join(root, 'frame.html'), '<p>frame</p>');
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  function serverConfig(): FrontMcpConfigInput {
    return {
      info: { name: 'user-content', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Warn, enableConsole: true },
      http: { port: 0, userContent: { port: 0, root } },
    };
  }

  const warned = () => warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');

  it('a serverless handler (createHandler) ignores it, with a startup warning', async () => {
    await FrontMcpInstance.createHandler(serverConfig());

    expect(warned()).toContain(`${IGNORED}: a serverless handler (createHandler) opens no listener of its own`);
    expect(log.mock.calls.map((call) => String(call[0]))).not.toContainEqual(expect.stringContaining('User content'));
  });

  it('a fetch handler (createFetchHandler) ignores it, with a startup warning', async () => {
    await FrontMcpInstance.createFetchHandler(serverConfig());

    expect(warned()).toContain(`${IGNORED}: a fetch handler for Workers and edge runtimes (createFetchHandler)`);
  });

  it('says nothing when the option is not set', async () => {
    await FrontMcpInstance.createHandler({ ...serverConfig(), http: { port: 0 } });

    expect(warned()).not.toContain(IGNORED);
  });
});
