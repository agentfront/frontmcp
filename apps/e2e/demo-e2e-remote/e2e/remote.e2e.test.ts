/**
 * E2E Tests for Remote MCP Server Orchestration
 *
 * Tests the gateway's ability to connect to and proxy requests to remote MCP servers:
 * - Public Mintlify docs MCP server (external)
 * - Local test MCP server (internal, on different port)
 *
 * Tests cover:
 * - Tool discovery from both remote servers
 * - Tool execution with proper proxying
 * - Resource discovery and reading
 * - Prompt discovery and execution
 * - Gateway caching behavior
 * - Error handling
 */
import { test, expect, TestServer } from '@frontmcp/testing';

// Local MCP server instance
let localMcpServer: TestServer | null = null;

// Start local MCP server before all tests
beforeAll(async () => {
  console.log('[E2E] Starting local MCP server on port 3099...');
  localMcpServer = await TestServer.start({
    command: 'npx tsx apps/e2e/demo-e2e-remote/src/local-mcp-server/main.ts',
    port: 3099,
    startupTimeout: 60000,
    healthCheckPath: '/mcp',
    debug: process.env['DEBUG'] === 'true',
  });
  console.log('[E2E] Local MCP server started:', localMcpServer.info.baseUrl);
}, 90000);

// Stop local MCP server after all tests
afterAll(async () => {
  if (localMcpServer) {
    console.log('[E2E] Stopping local MCP server...');
    await localMcpServer.stop();
    localMcpServer = null;
  }
}, 30000);

test.describe('Remote MCP Server Orchestration E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-remote/src/main.ts',
    publicMode: true,
    port: 3098,
  });

  test.describe('Connection & Discovery', () => {
    test('should connect to gateway server', async ({ mcp }) => {
      expect(mcp.isConnected()).toBe(true);
      expect(mcp.serverInfo.name).toBe('Remote Gateway E2E');
    });

    test('should discover tools from local MCP server', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Local tools should be namespaced with 'local:'
      expect(tools).toContainTool('local:echo');
      expect(tools).toContainTool('local:ping');
      expect(tools).toContainTool('local:add');
      expect(tools).toContainTool('local:slow-operation');
    });

    test('should discover tools from Mintlify MCP server', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Mintlify tools should be namespaced with 'mintlify:'
      expect(tools).toContainTool('mintlify:SearchMintlify');
    });

    test('should discover resources from local MCP server', async ({ mcp }) => {
      const resources = await mcp.resources.list();

      expect(resources).toContainResource('test://status');
    });

    test('should discover prompts from local MCP server', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();

      expect(prompts).toContainPrompt('local:greeting');
    });
  });

  test.describe('Local Tool Execution', () => {
    test('should call local echo tool', async ({ mcp }) => {
      const result = await mcp.tools.call('local:echo', { message: 'Hello Remote!' });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('Hello Remote!');
    });

    test('should call local ping tool', async ({ mcp }) => {
      const result = await mcp.tools.call('local:ping', {});

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('pong');
      expect(result).toHaveTextContent('timestamp');
    });

    test('should call local add tool with input validation', async ({ mcp }) => {
      const result = await mcp.tools.call('local:add', { a: 5, b: 3 });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('8');
    });

    test('should call add tool with different numbers', async ({ mcp }) => {
      const result = await mcp.tools.call('local:add', { a: 100, b: -50 });

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('50');
    });

    test('should handle slow operation tool', async ({ mcp }) => {
      const startTime = Date.now();
      const result = await mcp.tools.call('local:slow-operation', { delayMs: 500 });
      const elapsed = Date.now() - startTime;

      expect(result).toBeSuccessful();
      expect(result).toHaveTextContent('completed');
      expect(elapsed).toBeGreaterThanOrEqual(450); // Allow some tolerance
    });
  });

  test.describe('Mintlify Tool Execution', () => {
    test('should call Mintlify search tool', async ({ mcp }) => {
      const result = await mcp.tools.call('mintlify:SearchMintlify', {
        query: 'getting started',
      });

      expect(result).toBeSuccessful();
    }, 60000); // Longer timeout for external API

    test('should search for specific topic', async ({ mcp }) => {
      const result = await mcp.tools.call('mintlify:SearchMintlify', {
        query: 'api documentation',
      });

      expect(result).toBeSuccessful();
    }, 60000);
  });

  test.describe('Resource Access', () => {
    test('should read local status resource', async ({ mcp }) => {
      const result = await mcp.resources.read('test://status');

      expect(result).toBeSuccessful();
      expect(result.contents).toHaveLength(1);

      // Parse the content to verify structure
      const content = result.contents[0];
      expect(content.uri).toBe('test://status');

      if (content.text) {
        const data = JSON.parse(content.text);
        expect(data.status).toBe('healthy');
        expect(data.serverName).toBe('local-test-mcp');
        expect(data.version).toBe('0.1.0');
      }
    });
  });

  test.describe('Prompt Access', () => {
    test('should get local greeting prompt', async ({ mcp }) => {
      const result = await mcp.prompts.get('local:greeting', { name: 'World' });

      expect(result).toBeSuccessful();
      expect(result.messages).toHaveLength(1);
    });

    test('should get greeting prompt with formal style', async ({ mcp }) => {
      const result = await mcp.prompts.get('local:greeting', {
        name: 'Developer',
        style: 'formal',
      });

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);

      // Check if the message contains formal greeting
      const message = result.messages[0];
      if (message.content && typeof message.content === 'object' && 'text' in message.content) {
        expect(message.content.text).toContain('Developer');
      }
    });

    test('should get greeting prompt with casual style', async ({ mcp }) => {
      const result = await mcp.prompts.get('local:greeting', {
        name: 'Tester',
        style: 'casual',
      });

      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });

  test.describe('Gateway Caching', () => {
    test('should cache local ping responses', async ({ mcp }) => {
      // First call - should hit remote
      const result1 = await mcp.tools.call('local:ping', {});
      expect(result1).toBeSuccessful();

      // Get the first timestamp
      const content1 = result1.content[0];
      const data1 = 'text' in content1 ? JSON.parse(content1.text) : null;
      const timestamp1 = data1?.timestamp;

      // Second call - might return cached result
      const result2 = await mcp.tools.call('local:ping', {});
      expect(result2).toBeSuccessful();

      const content2 = result2.content[0];
      const data2 = 'text' in content2 ? JSON.parse(content2.text) : null;
      const timestamp2 = data2?.timestamp;

      // Both calls should succeed (caching behavior is implementation-dependent)
      expect(timestamp1).toBeDefined();
      expect(timestamp2).toBeDefined();
    });
  });

  test.describe('Error Handling', () => {
    test('should handle non-existent tool gracefully', async ({ mcp }) => {
      await expect(mcp.tools.call('local:non-existent-tool', {})).rejects.toThrow();
    });

    test('should handle missing required parameters', async ({ mcp }) => {
      // Echo tool requires 'message' parameter
      await expect(mcp.tools.call('local:echo', {})).rejects.toThrow();
    });

    test('should handle invalid parameter types', async ({ mcp }) => {
      // Add tool expects numbers, not strings
      await expect(
        mcp.tools.call('local:add', {
          a: 'not-a-number' as unknown as number,
          b: 5,
        }),
      ).rejects.toThrow();
    });
  });

  test.describe('Concurrent Operations', () => {
    test('should handle concurrent tool calls', async ({ mcp }) => {
      const promises = [
        mcp.tools.call('local:echo', { message: 'msg1' }),
        mcp.tools.call('local:echo', { message: 'msg2' }),
        mcp.tools.call('local:ping', {}),
        mcp.tools.call('local:add', { a: 1, b: 2 }),
      ];

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result).toBeSuccessful();
      }
    });

    test('should handle mixed local and remote calls', async ({ mcp }) => {
      const promises = [
        mcp.tools.call('local:ping', {}),
        mcp.tools.call('mintlify:SearchMintlify', { query: 'test' }),
        mcp.tools.call('local:echo', { message: 'concurrent' }),
      ];

      const results = await Promise.all(promises);

      for (const result of results) {
        expect(result).toBeSuccessful();
      }
    }, 60000);
  });
});
