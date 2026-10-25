import * as path from 'node:path';

import { Client, SSEClientTransport } from '@frontmcp/protocol/client';
import { TestServer } from '@frontmcp/testing';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');
const ENTRY_PATH = '/mcp';

describe('the official MCP SDK SSE client against the legacy HTTP+SSE transport', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      cwd: WORKSPACE_ROOT,
      env: { FRONTMCP_HTTP_ENTRY_PATH: ENTRY_PATH },
    });
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
  });

  it('connects with its default headers, lists tools and calls one', async () => {
    const client = new Client({ name: 'legacy-sse-e2e', version: '1.0.0' });
    await client.connect(new SSEClientTransport(new URL(`${server.info.baseUrl}${ENTRY_PATH}/sse`)));
    try {
      const { tools } = await client.listTools();
      const result = await client.callTool({ name: 'parent-hello', arguments: { name: 'SSE' } });

      expect(tools.map((tool) => tool.name)).toContain('parent-hello');
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        message: 'Hello, SSE! This is from the parent/root scope.',
        scope: 'parent',
      });
    } finally {
      await client.close();
    }
  });
});
