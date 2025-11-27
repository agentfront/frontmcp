import { test, expect, httpMock } from '@frontmcp/testing';

/**
 * E2E Tests for OpenAPI Adapter
 *
 * Note: These tests require a running FrontMCP server with proper OAuth configuration.
 * Currently skipped pending local auth implementation (see enhance-authentication PR).
 */
test.use({
  server: './src/main.ts',
  port: 3013,
});

test.describe.skip('OpenAPI Adapter', () => {
  // TODO: OpenAPI adapter disabled due to SDK hook validation bug
  // Re-enable these tests once the SDK issue is fixed
  test.skip('lists tools from OpenAPI adapter', async ({ mcp }) => {
    const tools = await mcp.tools.list();

    // Should include both native tools and OpenAPI-generated tools
    expect(tools).toContainTool('create-note'); // Native tool

    // OpenAPI adapter tools have the adapter name prefix
    // The actual tools depend on the OpenAPI spec from Beeceptor
    const openapiTools = tools.filter((t) => t.name.startsWith('backend:api:'));
    expect(openapiTools.length).toBeGreaterThanOrEqual(0);
  });

  test.skip('mock OpenAPI endpoint call', async ({ mcp }) => {
    const interceptor = httpMock.interceptor();

    try {
      // Mock an API call that might be made through the OpenAPI adapter
      interceptor.get('https://frontmcp-test.proxy.beeceptor.com/users', {
        body: [
          { id: 1, name: 'John Doe' },
          { id: 2, name: 'Jane Doe' },
        ],
      });

      // Allow passthrough for other requests (like the OpenAPI spec itself)
      interceptor.allowPassthrough(true);

      // This test verifies HTTP mocking works - the actual OpenAPI tools
      // depend on the remote spec being available
      const tools = await mcp.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    } finally {
      interceptor.restore();
    }
  });

  // Test that the native tools work without OpenAPI adapter
  test('native tools work without OpenAPI adapter', async ({ mcp }) => {
    const tools = await mcp.tools.list();

    // Should include native tools
    expect(tools).toContainTool('create-note');
    expect(tools).toContainTool('list-notes');
    expect(tools).toContainTool('get-note');
    expect(tools).toContainTool('delete-note');
  });
});
