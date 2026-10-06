/**
 * The SSE transport connects to a default (public) server without `publicMode` (#766): it takes
 * the server's anonymous token, opens the stream and posts its messages with that token.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import { SseTransport } from '../sse.transport';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

let node: http.Server;
let base: string;

beforeAll(async () => {
  const handler = (await FrontMcpInstance.createHandler({
    info: { name: 'sse-public', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  })) as http.RequestListener;
  node = http.createServer(handler);
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    node.close(() => resolve());
    node.closeAllConnections();
  });
});

describe('SseTransport against a default public server', () => {
  it('initializes and calls a tool without publicMode', async () => {
    const transport = new SseTransport({ baseUrl: base, timeout: 5000 });
    await transport.connect();
    try {
      const init = await transport.request({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spec', version: '1' } },
      });
      expect(init.error).toBeUndefined();
      await transport.notify({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);

      const call = await transport.request({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'ping', arguments: {} },
      });
      expect(JSON.stringify(call.result)).toContain('pong');
    } finally {
      await transport.close();
    }
  });
});
