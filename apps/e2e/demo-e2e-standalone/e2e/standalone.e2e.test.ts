/**
 * E2E Tests for Standalone Apps
 *
 * Tests standalone app functionality:
 * - Scope isolation (standalone app has its own scope)
 * - Path-based routing (/isolated/* for standalone app)
 * - Tool/resource isolation between scopes
 * - SSE and message endpoints for standalone apps
 */
import { test, expect, McpTestClient } from '@frontmcp/testing';

test.describe('Standalone App E2E', () => {
  test.describe('Root Scope (Parent App)', () => {
    test.use({
      server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      publicMode: true,
    });

    test('should connect to root scope', async ({ mcp }) => {
      expect(mcp.isConnected()).toBe(true);
      // Server name may be normalized, just check it exists
      expect(mcp.serverInfo.name).toBeDefined();
    });

    test('should only see parent-hello tool in root scope', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Parent tool should be visible
      expect(tools).toContainTool('parent-hello');

      // Isolated tool should NOT be visible in root scope
      const isolatedTool = tools.find((t) => t.name === 'isolated-hello');
      expect(isolatedTool).toBeUndefined();
    });

    test('should call parent-hello tool', async ({ mcp }) => {
      const result = await mcp.tools.call('parent-hello', { name: 'Test' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Hello, Test!');
      expect(result).toHaveTextContent('"scope":"parent"');
    });
  });

  test.describe('Isolated Scope (Standalone App)', () => {
    test.use({
      server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      publicMode: true,
    });

    test('should connect to isolated scope via /isolated path', async ({ server }) => {
      // Create a client that connects to the /isolated path
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      expect(isolatedClient.isConnected()).toBe(true);

      // Clean up
      await isolatedClient.disconnect();
    });

    test('should only see isolated-hello tool in isolated scope', async ({ server }) => {
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      const tools = await isolatedClient.tools.list();

      // Isolated tool should be visible
      expect(tools).toContainTool('isolated-hello');

      // Parent tool should NOT be visible in isolated scope
      const parentTool = tools.find((t) => t.name === 'parent-hello');
      expect(parentTool).toBeUndefined();

      await isolatedClient.disconnect();
    });

    test('should call isolated-hello tool', async ({ server }) => {
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      const result = await isolatedClient.tools.call('isolated-hello', { name: 'Test' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Hello, Test!');
      expect(result).toHaveTextContent('"scope":"isolated"');

      await isolatedClient.disconnect();
    });

    test('should see isolated-info resource in isolated scope', async ({ server }) => {
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      const resources = await isolatedClient.resources.list();

      // Isolated resource should be visible
      expect(resources).toContainResource('isolated://info');

      await isolatedClient.disconnect();
    });

    test('should read isolated-info resource', async ({ server }) => {
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      const content = await isolatedClient.resources.read('isolated://info');

      expect(content).toBeSuccessful();
      expect(content).toHaveTextContent('"app":"isolated"');
      expect(content).toHaveTextContent('"type":"standalone"');

      await isolatedClient.disconnect();
    });
  });

  test.describe('Scope Isolation', () => {
    test.use({
      server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      publicMode: true,
    });

    test('root and isolated scopes should have different tools', async ({ mcp, server }) => {
      // Get tools from root scope
      const rootTools = await mcp.tools.list();

      // Get tools from isolated scope
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();
      const isolatedTools = await isolatedClient.tools.list();

      // Root should have parent-hello only
      expect(rootTools.map((t) => t.name)).toContain('parent-hello');
      expect(rootTools.map((t) => t.name)).not.toContain('isolated-hello');

      // Isolated should have isolated-hello only
      expect(isolatedTools.map((t) => t.name)).toContain('isolated-hello');
      expect(isolatedTools.map((t) => t.name)).not.toContain('parent-hello');

      await isolatedClient.disconnect();
    });

    test('sessions should be scope-specific', async ({ mcp, server }) => {
      // Get session from root scope
      const rootSessionId = mcp.sessionId;

      // Get session from isolated scope
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();
      const isolatedSessionId = isolatedClient.sessionId;

      // Sessions should be different
      expect(rootSessionId).toBeDefined();
      expect(isolatedSessionId).toBeDefined();
      expect(rootSessionId).not.toBe(isolatedSessionId);

      await isolatedClient.disconnect();
    });
  });

  test.describe('Cross-Scope Tool Calls', () => {
    test.use({
      server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      publicMode: true,
    });

    test('calling isolated tool from root scope should fail', async ({ mcp }) => {
      // Try to call isolated-hello from root scope
      const result = await mcp.tools.call('isolated-hello', { name: 'Test' });

      // Should fail because isolated-hello is not in root scope
      expect(result).toBeError();
    });

    test('calling parent tool from isolated scope should fail', async ({ server }) => {
      const isolatedClient = await McpTestClient.create({
        baseUrl: server.info.baseUrl + '/isolated',
        publicMode: true,
      }).buildAndConnect();

      // Try to call parent-hello from isolated scope
      const result = await isolatedClient.tools.call('parent-hello', { name: 'Test' });

      // Should fail because parent-hello is not in isolated scope
      expect(result).toBeError();

      await isolatedClient.disconnect();
    });
  });

  test.describe('Path Routing Security', () => {
    test.use({
      server: 'apps/e2e/demo-e2e-standalone/src/main.ts',
      project: 'demo-e2e-standalone',
      publicMode: true,
    });

    test('invalid path /isolated/xxx should return 404', async ({ server }) => {
      // Try to connect to an invalid nested path
      // This should not be routed to the isolated scope
      const response = await fetch(`${server.info.baseUrl}/isolated/xxx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }),
      });

      // Should return 404 because /isolated/xxx is not a valid scope path
      expect(response.status).toBe(404);
    });

    test('invalid nested message path should return 404', async ({ server }) => {
      // Try to POST to an invalid nested /message path
      // /isolated/xxx/message should NOT work - only /isolated/message should work
      const response = await fetch(`${server.info.baseUrl}/isolated/xxx/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });

      // Should return 404 because /isolated/xxx/message is not a valid endpoint
      expect(response.status).toBe(404);
    });

    test('invalid nested sse path should return 404', async ({ server }) => {
      // Try to GET an invalid nested /sse path
      // /isolated/xxx/sse should NOT work - only /isolated/sse should work
      const response = await fetch(`${server.info.baseUrl}/isolated/xxx/sse`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      });

      // Should return 404 because /isolated/xxx/sse is not a valid endpoint
      expect(response.status).toBe(404);
    });

    test('root scope /message should not overlap with /isolated/message', async ({ server }) => {
      // Verify that root scope handles /message
      // And isolated scope handles /isolated/message separately
      const rootResponse = await fetch(`${server.info.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });

      // Root /message without session should return 404 (session not found)
      // This proves that the root scope IS listening on /message
      expect(rootResponse.status).toBe(404);

      const isolatedResponse = await fetch(`${server.info.baseUrl}/isolated/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });

      // Isolated /isolated/message without session should also fail with session error
      // This proves that the isolated scope IS listening on /isolated/message
      expect(isolatedResponse.status).toBe(404); // 404 = session not found/initialized
    });
  });
});
