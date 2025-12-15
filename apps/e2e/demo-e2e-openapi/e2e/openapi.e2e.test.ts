/**
 * E2E Tests for OpenAPI Adapter
 *
 * Tests the OpenAPI adapter that generates MCP tools from an OpenAPI spec.
 * All HTTP calls to the external API are mocked.
 */
import { test, expect, httpMock } from '@frontmcp/testing';

const API_BASE = 'https://frontmcp-test.proxy.beeceptor.com';

test.describe('OpenAPI Adapter E2E', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-openapi/src/main.ts',
    publicMode: true,
  });

  test.beforeEach(() => {
    // Mock the OpenAPI spec fetch
    const interceptor = httpMock.interceptor();

    interceptor.get(`${API_BASE}/openapi.json`, {
      body: {
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
      },
    });

    // Mock product list endpoint
    interceptor.get(`${API_BASE}/products`, {
      body: [
        { id: 'prod-1', name: 'Widget', price: 9.99 },
        { id: 'prod-2', name: 'Gadget', price: 19.99 },
        { id: 'prod-3', name: 'Gizmo', price: 29.99 },
      ],
    });

    // Mock single product endpoint
    interceptor.get(/\/products\/prod-\d+/, {
      body: { id: 'prod-1', name: 'Widget', price: 9.99, description: 'A useful widget' },
    });

    // Mock user registration
    interceptor.post(`${API_BASE}/auth/register`, {
      status: 201,
      body: { id: 'user-1', email: 'test@example.com' },
    });
  });

  test.afterEach(() => {
    httpMock.clearAll();
  });

  test.describe('Tool Generation', () => {
    test('should generate tools from OpenAPI spec', async ({ mcp }) => {
      const tools = await mcp.tools.list();

      // Tools should be generated from OpenAPI operations
      expect(tools.length).toBeGreaterThan(0);
    });

    test('should include operation metadata in tools', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const listProductsTool = tools.find((t) => t.name.includes('listProducts') || t.name.includes('list-products'));

      expect(listProductsTool).toBeDefined();
      expect(listProductsTool?.description).toBeDefined();
    });
  });

  test.describe('Tool Execution with Mocked API', () => {
    test('should call list products endpoint', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const listTool = tools.find((t) => t.name.includes('listProducts') || t.name.includes('list-products'));

      if (listTool) {
        const result = await mcp.tools.call(listTool.name, {});
        expect(result).toBeSuccessful();
        expect(result).toHaveTextContent('Widget');
      }
    });

    test('should call get product endpoint with path parameter', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const getTool = tools.find((t) => t.name.includes('getProduct') || t.name.includes('get-product'));

      if (getTool) {
        const result = await mcp.tools.call(getTool.name, { id: 'prod-1' });
        expect(result).toBeSuccessful();
      }
    });

    test('should call POST endpoint for registration', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      const registerTool = tools.find((t) => t.name.includes('registerUser') || t.name.includes('register'));

      if (registerTool) {
        const result = await mcp.tools.call(registerTool.name, {
          email: 'test@example.com',
          password: 'secret123',
        });
        expect(result).toBeSuccessful();
      }
    });
  });

  test.describe('Error Handling', () => {
    test('should handle API errors gracefully', async ({ mcp }) => {
      const interceptor = httpMock.interceptor();
      interceptor.get(`${API_BASE}/products`, {
        status: 500,
        body: { error: 'Internal Server Error' },
      });

      const tools = await mcp.tools.list();
      const listTool = tools.find((t) => t.name.includes('listProducts') || t.name.includes('list-products'));

      if (listTool) {
        const result = await mcp.tools.call(listTool.name, {});
        expect(result).toBeError();
      }
    });

    test('should handle 404 responses', async ({ mcp }) => {
      const interceptor = httpMock.interceptor();
      interceptor.get(/\/products\/nonexistent/, {
        status: 404,
        body: { error: 'Product not found' },
      });

      const tools = await mcp.tools.list();
      const getTool = tools.find((t) => t.name.includes('getProduct') || t.name.includes('get-product'));

      if (getTool) {
        const result = await mcp.tools.call(getTool.name, { id: 'nonexistent' });
        expect(result).toBeError();
      }
    });
  });

  test.describe('Resource Access', () => {
    test('should list custom resources', async ({ mcp }) => {
      const resources = await mcp.resources.list();
      expect(resources).toContainResource('ecommerce://catalog');
    });

    test('should read catalog resource', async ({ mcp }) => {
      const content = await mcp.resources.read('ecommerce://catalog');
      expect(content).toBeSuccessful();
    });
  });

  test.describe('Prompt Access', () => {
    test('should list prompts', async ({ mcp }) => {
      const prompts = await mcp.prompts.list();
      expect(prompts).toContainPrompt('product-recommendation');
    });

    test('should get prompt with arguments', async ({ mcp }) => {
      const result = await mcp.prompts.get('product-recommendation', {
        category: 'electronics',
        budget: 100,
      });
      expect(result).toBeSuccessful();
      expect(result.messages.length).toBeGreaterThan(0);
    });
  });
});
