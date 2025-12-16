/**
 * E2E Tests for OpenAPI Adapter
 *
 * Tests the OpenAPI adapter that generates MCP tools from an OpenAPI spec.
 * Uses MockAPIServer to provide both the OpenAPI spec and mock API responses.
 */
import { TestServer, MockAPIServer, expect } from '@frontmcp/testing';

// OpenAPI spec for testing
const OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: { title: 'E-commerce API', version: '1.0.0' },
  paths: {
    '/products': {
      get: {
        operationId: 'listProducts',
        summary: 'List all products',
        responses: {
          '200': {
            description: 'Product list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      price: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/products/{id}': {
      get: {
        operationId: 'getProduct',
        summary: 'Get product by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Product details',
          },
        },
      },
    },
    '/auth/register': {
      post: {
        operationId: 'registerUser',
        summary: 'Register a new user',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created' },
        },
      },
    },
  },
};

describe('OpenAPI Adapter E2E', () => {
  let mockApi: MockAPIServer;
  let server: TestServer;

  beforeAll(async () => {
    // Create mock API server
    mockApi = new MockAPIServer({
      openApiSpec: OPENAPI_SPEC,
      routes: [
        {
          method: 'GET',
          path: '/products',
          response: {
            body: [
              { id: 'prod-1', name: 'Widget', price: 9.99 },
              { id: 'prod-2', name: 'Gadget', price: 19.99 },
              { id: 'prod-3', name: 'Gizmo', price: 29.99 },
            ],
          },
        },
        {
          method: 'GET',
          path: '/products/:id',
          response: {
            body: { id: 'prod-1', name: 'Widget', price: 9.99, description: 'A useful widget' },
          },
        },
        {
          method: 'POST',
          path: '/auth/register',
          response: {
            status: 201,
            body: { id: 'user-1', email: 'test@example.com' },
          },
        },
      ],
      debug: false,
    });
    const apiInfo = await mockApi.start();

    // Start MCP server pointing to mock API
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-openapi/src/main.ts',
      env: {
        OPENAPI_BASE_URL: apiInfo.baseUrl,
        OPENAPI_SPEC_URL: apiInfo.specUrl,
      },
      startupTimeout: 30000,
      debug: false,
    });
  }, 60000);

  afterAll(async () => {
    if (server) {
      await server.stop();
    }
    if (mockApi) {
      await mockApi.stop();
    }
  });

  describe('Tool Generation', () => {
    it('should generate tools from OpenAPI spec', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      expect(response.ok).toBe(true);
      const sessionId = response.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List tools
      const toolsResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(toolsResponse.ok).toBe(true);
      const toolsText = await toolsResponse.text();
      // Should have generated tools from OpenAPI spec
      expect(toolsText).toContain('tools');
    });
  });

  describe('Resource Access', () => {
    it('should list custom resources', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      const sessionId = response.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List resources
      const resourcesResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'resources/list',
          params: {},
        }),
      });

      expect(resourcesResponse.ok).toBe(true);
      const resourcesText = await resourcesResponse.text();
      expect(resourcesText).toContain('ecommerce://catalog');
    });
  });

  describe('Prompt Access', () => {
    it('should list prompts', async () => {
      const response = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }),
      });

      const sessionId = response.headers.get('mcp-session-id');

      // Send initialized notification
      await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      });

      // List prompts
      const promptsResponse = await fetch(`${server.info.baseUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'mcp-session-id': sessionId ?? '',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'prompts/list',
          params: {},
        }),
      });

      expect(promptsResponse.ok).toBe(true);
      const promptsText = await promptsResponse.text();
      expect(promptsText).toContain('product-recommendation');
    });
  });
});
