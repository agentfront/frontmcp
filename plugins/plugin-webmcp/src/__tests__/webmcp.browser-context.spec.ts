import 'reflect-metadata';

import { create, LogLevel, Tool, ToolContext, type DirectMcpServer } from '@frontmcp/sdk';

import WebMcpPlugin from '../webmcp.plugin';
import { FakeModelContext, settle } from './helpers/fake-model-context';

/**
 * In a browser without AsyncContext the server runs one request at a time
 * (`#async-context` → `browser-async-context.ts`). A WebMCP call is such a request. A page tool
 * (`server.registerTool()`) that calls its own server back must still finish, not wait for itself.
 */
jest.mock('#async-context', () => jest.requireActual('../../../../libs/utils/src/async-context/browser-async-context'));

@Tool({ name: 'inventory', description: 'Stock level', inputSchema: {} })
class InventoryTool extends ToolContext {
  async execute() {
    return 'in stock';
  }
}

describe('WebMCP calls on the browser async-context runtime', () => {
  let server: DirectMcpServer;
  let modelContext: FakeModelContext;

  beforeEach(async () => {
    modelContext = new FakeModelContext();
    server = await create({
      info: { name: 'webmcp-browser', version: '1.0.0' },
      tools: [InventoryTool],
      plugins: [WebMcpPlugin.init({ modelContext })],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('completes a page tool that calls its own server back', async () => {
    await server.registerTool({
      name: 'check_and_reserve',
      description: 'Checks stock through the server, then reserves',
      execute: async () => {
        const stock = await server.callTool('inventory');
        return { content: [{ type: 'text', text: `reserved (${JSON.stringify(stock.content)})` }] };
      },
    });
    await settle();

    const result = await modelContext.execute('check_and_reserve');

    expect(JSON.stringify(result)).toContain('in stock');
  });

  it('serves overlapping agent calls', async () => {
    await settle();

    const results = await Promise.all([modelContext.execute('inventory'), modelContext.execute('inventory')]);

    expect(results.map((result) => JSON.stringify(result))).toEqual([
      expect.stringContaining('in stock'),
      expect.stringContaining('in stock'),
    ]);
  });
});
