/**
 * E2E Tests for OpenAPI Adapter Security
 *
 * Tests that staticAuth and other auth mechanisms correctly send
 * Authorization headers to the backend API.
 *
 * These tests use MockAPIServer with handler functions to capture
 * and verify the actual headers received by the mock API.
 */
import { TestServer, MockAPIServer, McpTestClient, expect, MockRequest, MockResponseHelper } from '@frontmcp/testing';

// Track received headers for verification
let lastReceivedHeaders: Record<string, string | undefined> = {};

// OpenAPI spec with bearer auth
const SECURED_OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Secured API', version: '1.0.0' },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/secured-endpoint': {
      get: {
        operationId: 'getSecuredData',
        summary: 'Get secured data (requires auth)',
        security: [{ BearerAuth: [] }],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    receivedAuth: { type: 'string' },
                  },
                },
              },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/public-endpoint': {
      get: {
        operationId: 'getPublicData',
        summary: 'Get public data (no auth required)',
        security: [],
        responses: {
          '200': {
            description: 'Success',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

describe('OpenAPI Adapter Security E2E', () => {
  let mockApi: MockAPIServer;
  let server: TestServer;
  let client: McpTestClient;

  beforeAll(async () => {
    // Reset captured headers
    lastReceivedHeaders = {};

    // Create mock API server with handler to capture headers
    mockApi = new MockAPIServer({
      openApiSpec: SECURED_OPENAPI_SPEC,
      routes: [
        {
          method: 'GET',
          path: '/secured-endpoint',
          handler: (req: MockRequest, res: MockResponseHelper) => {
            // Capture headers for verification
            lastReceivedHeaders = { ...req.headers };

            const authHeader = req.headers['authorization'];
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
              res.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
              return;
            }

            res.json({
              message: 'Access granted',
              receivedAuth: authHeader,
            });
          },
        },
        {
          method: 'GET',
          path: '/public-endpoint',
          handler: (req: MockRequest, res: MockResponseHelper) => {
            // Capture headers for public endpoint too
            lastReceivedHeaders = { ...req.headers };

            res.json({
              message: 'Public data',
              hasAuth: !!req.headers['authorization'],
            });
          },
        },
      ],
      debug: false,
    });
    const apiInfo = await mockApi.start();

    // Start MCP server with staticAuth configuration
    server = await TestServer.start({
      command: 'npx tsx apps/e2e/demo-e2e-openapi/src/security-test-main.ts',
      env: {
        OPENAPI_BASE_URL: apiInfo.baseUrl,
        OPENAPI_SPEC_URL: apiInfo.specUrl,
        STATIC_AUTH_JWT: 'test-jwt-token-12345',
      },
      startupTimeout: 30000,
      debug: false,
    });

    client = await McpTestClient.create({
      baseUrl: server.info.baseUrl,
      transport: 'streamable-http',
      publicMode: true,
    }).buildAndConnect();
  }, 60000);

  afterAll(async () => {
    if (client) await client.disconnect();
    if (server) await server.stop();
    if (mockApi) await mockApi.stop();
  });

  beforeEach(() => {
    // Reset captured headers before each test
    lastReceivedHeaders = {};
  });

  describe('Tool Generation with Security', () => {
    it('should generate tools from secured OpenAPI spec', async () => {
      const tools = await client.tools.list();

      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);

      // Verify secured tool exists
      const securedTool = tools.find((t) => t.name === 'getSecuredData');
      expect(securedTool).toBeDefined();

      // Verify public tool exists
      const publicTool = tools.find((t) => t.name === 'getPublicData');
      expect(publicTool).toBeDefined();
    });
  });

  describe('staticAuth JWT', () => {
    it('should include Authorization Bearer header in API requests', async () => {
      // Call the secured tool
      const result = await client.tools.call('getSecuredData', {});

      // Verify the response indicates success (auth was accepted)
      expect(result).toBeDefined();
      expect(result.isSuccess).toBe(true);

      // Parse the JSON response - OpenAPI adapter wraps in { data: { ... } }
      const response = result.json<{ data: { message: string; receivedAuth: string } }>();
      expect(response.data.message).toBe('Access granted');
      expect(response.data.receivedAuth).toBe('Bearer test-jwt-token-12345');
    });

    it('should have sent Authorization header to mock server', async () => {
      // Call the tool to populate lastReceivedHeaders
      await client.tools.call('getSecuredData', {});

      // Verify the header was actually received by the mock server
      expect(lastReceivedHeaders['authorization']).toBe('Bearer test-jwt-token-12345');
    });

    it('should include accept header in requests', async () => {
      await client.tools.call('getSecuredData', {});

      // Verify accept header is set
      expect(lastReceivedHeaders['accept']).toBe('application/json');
    });
  });

  describe('Public Endpoints', () => {
    it('should NOT include auth header for public endpoints (security: [])', async () => {
      // Call the public tool (which has security: [] in OpenAPI spec)
      const result = await client.tools.call('getPublicData', {});

      expect(result).toBeDefined();
      expect(result.isSuccess).toBe(true);

      // Parse the JSON response - OpenAPI adapter wraps in { data: { ... } }
      const response = result.json<{ data: { message: string; hasAuth: boolean } }>();
      expect(response.data.message).toBe('Public data');

      // Public endpoints with security: [] should NOT receive auth
      // This is correct behavior - auth is only sent for endpoints that require it
      expect(response.data.hasAuth).toBe(false);
    });
  });
});
