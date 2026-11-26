/**
 * #1364: `http.userContent` opens a second listener that starts and stops with a Node HTTP server. The entries that
 * open no listener of their own (serverless, fetch) ignore it and say so at startup.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
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

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'fmcp-uc-entry-'));
    fs.writeFileSync(path.join(root, 'frame.html'), '<p>frame</p>');
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function serverConfig(): FrontMcpConfigInput {
    return {
      info: { name: 'user-content', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Warn, enableConsole: true },
      http: { port: 0, userContent: { port: 0, root } },
    };
  }

  /** The port a listener reported on startup, from its `... on 127.0.0.1:<port>` line. */
  function loggedPort(prefix: string): number {
    const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.startsWith(prefix));
    const port = Number(line?.match(/:(\d+)\b/)?.[1]);
    if (!port) throw new Error(`no "${prefix}" line was logged`);
    return port;
  }

  const warned = () => warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');

  it('a Node HTTP server serves the content beside MCP, and shutdown closes both listeners', async () => {
    const instance = new FrontMcpInstance(frontMcpMetadataSchema.parse(serverConfig()));
    await instance.ready;
    await instance.start();
    const mcpUrl = `http://localhost:${loggedPort('MCP HTTP (Express) on')}`;
    const contentUrl = `http://localhost:${loggedPort('User content on')}`;

    try {
      expect(await (await fetch(`${contentUrl}/frame.html`)).text()).toBe('<p>frame</p>');
      expect((await fetch(`${mcpUrl}/frame.html`)).status).toBe(404);
      expect((await fetch(`${mcpUrl}/health`)).status).toBe(200);
      expect((await fetch(`${contentUrl}/health`)).status).toBe(404);
      expect(warned()).not.toContain(IGNORED);
    } finally {
      await instance.shutdown();
    }

    await expect(fetch(`${contentUrl}/frame.html`)).rejects.toThrow();
    await expect(fetch(`${mcpUrl}/health`)).rejects.toThrow();
  });

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
