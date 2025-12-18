/**
 * E2E Tests for OpenAPI Adapter
 *
 * Tests the OpenAPI adapter that generates MCP tools from an OpenAPI spec.
 * Uses MockAPIServer to provide both the OpenAPI spec and mock API responses.
 * Uses @frontmcp/testing McpTestClient for clean, type-safe MCP interactions.
 */
import { TestServer, MockAPIServer, McpTestClient, expect } from '@frontmcp/testing';

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
  let client: McpTestClient;

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

    // Create a shared client for all tests
    client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      publicMode: true,
    }).buildAndConnect();
  }, 60000);

  afterAll(async () => {
    if (client) {
      await client.disconnect();
    }
    if (server) {
      await server.stop();
    }
    if (mockApi) {
      await mockApi.stop();
    }
  });

  describe('Tool Generation', () => {
    it('should generate tools from OpenAPI spec', async () => {
      const tools = await client.tools.list();

      // Should have generated tools from OpenAPI spec
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);

      // Verify tool names match operationIds from the spec
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('listProducts');
      expect(toolNames).toContain('getProduct');
      expect(toolNames).toContain('registerUser');
    });
  });

  describe('Resource Access', () => {
    it('should list custom resources', async () => {
      const resources = await client.resources.list();

      expect(resources).toBeDefined();
      expect(resources.length).toBeGreaterThan(0);

      // Verify the catalog resource exists
      const catalogResource = resources.find((r) => r.uri === 'ecommerce://catalog');
      expect(catalogResource).toBeDefined();
    });
  });

  describe('Prompt Access', () => {
    it('should list prompts', async () => {
      const prompts = await client.prompts.list();

      expect(prompts).toBeDefined();
      expect(prompts.length).toBeGreaterThan(0);

      // Verify the product-recommendation prompt exists
      const recommendationPrompt = prompts.find((p) => p.name === 'product-recommendation');
      expect(recommendationPrompt).toBeDefined();
    });
  });
});
