import 'reflect-metadata';

import * as net from 'node:net';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'ping', description: 'Answer pong', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'pinger', name: 'Pinger', tools: [PingTool] })
class PingerApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'extract-serving', version: '1.0.0' },
  apps: [PingerApp],
  http: { port: 0 },
  logging: { level: LogLevel.Off },
};

describe('serving while a build loads the entry for its metadata (FRONTMCP_SCHEMA_EXTRACT=1)', () => {
  afterEach(() => {
    delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
    jest.restoreAllMocks();
  });

  it('bootstrap() serves nothing', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';

    const started = await FrontMcpInstance.bootstrap(config);
    await started?.shutdown();

    expect(started).toBeUndefined();
    expect(listen).not.toHaveBeenCalled();
  });

  it('runStdio() and runUnixSocket() serve nothing, and leave the console alone', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const log = console.log;
    process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';

    await expect(FrontMcpInstance.runStdio(config)).resolves.toBeUndefined();
    const socket = await FrontMcpInstance.runUnixSocket({
      ...config,
      socketPath: '/tmp/frontmcp-extract-serving.sock',
    });
    await socket.close();

    expect(console.log).toBe(log);
    expect(listen).not.toHaveBeenCalled();
  });

  it('runShared() starts, attaches to and imports nothing', async () => {
    const listen = jest.spyOn(net.Server.prototype, 'listen');
    const readStdin = jest.spyOn(process.stdin, 'on');
    process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';

    await expect(FrontMcpInstance.runShared(config, { key: 'extract-serving' })).resolves.toBeUndefined();

    expect(listen).not.toHaveBeenCalled();
    expect(readStdin).not.toHaveBeenCalled();
  });
});
