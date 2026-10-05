import 'reflect-metadata';

import { App, Tool, ToolContext } from '../../common';
import { connect } from '../../direct';
import { FrontMcpInstance } from '../front-mcp';

// The browser and worker builds resolve `#express-host` to this stub, whose constructor throws (#747).
jest.mock('#express-host', () => jest.requireActual('../../server/adapters/polyfills/browser-express-host'));

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { ok: true };
  }
}

@App({ id: 'ping', name: 'Ping', tools: [PingTool] })
class PingApp {}

const config = { info: { name: 'browser-host', version: '1.0.0' }, apps: [PingApp] };

describe('entry points that never listen, with the browser build of the Express host', () => {
  it('createFetchHandler builds a handler that answers', async () => {
    const handler = await FrontMcpInstance.createFetchHandler(config);

    const response = await handler(new Request('https://example.com/healthz'));

    expect(response.status).toBe(200);
  });

  it('createDirect builds a server that lists its tools', async () => {
    const server = await FrontMcpInstance.createDirect(config);
    try {
      const { tools } = await server.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['ping']);
    } finally {
      await server.dispose();
    }
  });

  it('connect returns a client that lists its tools', async () => {
    const client = await connect({ ...config, info: { name: 'browser-host-connect', version: '1.0.0' } });
    try {
      const tools = (await client.listTools()) as Array<{ name: string }>;
      expect(tools.map((tool) => tool.name)).toEqual(['ping']);
    } finally {
      await client.close();
    }
  });
});
