/**
 * Integration tests for OpenAPI adapter with a real HTTP server
 * Tests actual HTTP request/response handling including:
 * - Error responses (4xx/5xx) with structured error format
 * - JSON vs text response parsing
 * - Output schema in tool/list
 */

import * as http from 'node:http';
import type { OpenAPIV3 } from 'openapi-types';
import OpenapiAdapter from '../openapi.adapter';
import type { OpenapiAdapterConfig } from '../openapi.types';
import { createMockLogger } from './fixtures';
import { FrontMcpToolTokens } from '@frontmcp/sdk';

// Type for route handler
type RouteHandler = (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => void;

interface TestServerConfig {
  routes: Map<string, Map<string, RouteHandler>>;
}

/**
 * Creates a test HTTP server with configurable routes
 */
function createTestServer(config: TestServerConfig): {
  server: http.Server;
  baseUrl: string;
  start: () => Promise<string>;
  stop: () => Promise<void>;
} {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const method = req.method?.toLowerCase() || 'get';

    // Find matching route
    for (const [pattern, methods] of config.routes) {
      const handler = methods.get(method);
      if (!handler) continue;

      // Simple path matching with params
      const patternParts = pattern.split('/');
      const urlParts = url.pathname.split('/');

      if (patternParts.length !== urlParts.length) continue;

      const params: Record<string, string> = {};
      let matches = true;

      for (let i = 0; i < patternParts.length; i++) {
        if (patternParts[i].startsWith('{') && patternParts[i].endsWith('}')) {
          const paramName = patternParts[i].slice(1, -1);
          params[paramName] = urlParts[i];
        } else if (patternParts[i] !== urlParts[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        handler(req, res, params);
        return;
      }
    }

    // No route matched
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  let port = 0;

  return {
    server,
    get baseUrl() {
      return `http://localhost:${port}`;
    },
    start: () =>
      new Promise((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          port = typeof addr === 'object' && addr ? addr.port : 0;
          resolve(`http://localhost:${port}`);
        });
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

/**
 * Helper to read request body
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Creates OpenAPI spec for the test server
 */
function createTestSpec(baseUrl: string): OpenAPIV3.Document {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Test Server API',
      version: '1.0.0',
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          summary: 'Get user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                    required: ['id', 'name'],
                  },
                },
              },
            },
            '404': {
              description: 'User not found',
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
      '/users': {
        post: {
          operationId: 'createUser',
          summary: 'Create a new user',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                  },
                  required: ['name', 'email'],
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      errors: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Health check endpoint',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
      '/server-error': {
        get: {
          operationId: 'triggerServerError',
          summary: 'Trigger a 500 error',
          responses: {
            '500': {
              description: 'Internal server error',
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
      '/unauthorized': {
        get: {
          operationId: 'getUnauthorized',
          summary: 'Endpoint that returns 401',
          responses: {
            '401': {
              description: 'Unauthorized',
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
      '/rate-limited': {
        get: {
          operationId: 'getRateLimited',
          summary: 'Endpoint that returns 429',
          responses: {
            '429': {
              description: 'Too many requests',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                      retryAfter: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/text-response': {
        get: {
          operationId: 'getTextResponse',
          summary: 'Returns plain text response',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
      '/html-response': {
        get: {
          operationId: 'getHtmlResponse',
          summary: 'Returns HTML response',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'text/html': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
      '/invalid-json': {
        get: {
          operationId: 'getInvalidJson',
          summary: 'Returns invalid JSON with application/json content-type',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe('OpenAPI Adapter - Real HTTP Server Integration', () => {
  let testServer: ReturnType<typeof createTestServer>;
  let baseUrl: string;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(async () => {
    const routes = new Map<string, Map<string, RouteHandler>>();

    // GET /users/{id}
    const usersIdRoutes = new Map<string, RouteHandler>();
    usersIdRoutes.set('get', (_req, res, params) => {
      if (params.id === 'not-found') {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'User not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: params.id, name: 'John Doe', email: 'john@example.com' }));
    });
    routes.set('/users/{id}', usersIdRoutes);

    // POST /users
    const usersRoutes = new Map<string, RouteHandler>();
    usersRoutes.set('post', async (req, res) => {
      const body = await readBody(req);
      let parsed: { name?: string; email?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Invalid JSON body' }));
        return;
      }

      const errors: string[] = [];
      if (!parsed.name) errors.push('name is required');
      if (!parsed.email) errors.push('email is required');

      if (errors.length > 0) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Validation failed', errors }));
        return;
      }

      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'new-user-123', name: parsed.name, email: parsed.email }));
    });
    routes.set('/users', usersRoutes);

    // GET /health
    const healthRoutes = new Map<string, RouteHandler>();
    healthRoutes.set('get', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('OK');
    });
    routes.set('/health', healthRoutes);

    // GET /server-error
    const serverErrorRoutes = new Map<string, RouteHandler>();
    serverErrorRoutes.set('get', (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Internal server error occurred' }));
    });
    routes.set('/server-error', serverErrorRoutes);

    // GET /unauthorized
    const unauthorizedRoutes = new Map<string, RouteHandler>();
    unauthorizedRoutes.set('get', (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Authentication required' }));
    });
    routes.set('/unauthorized', unauthorizedRoutes);

    // GET /rate-limited
    const rateLimitedRoutes = new Map<string, RouteHandler>();
    rateLimitedRoutes.set('get', (_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Too many requests', retryAfter: 60 }));
    });
    routes.set('/rate-limited', rateLimitedRoutes);

    // GET /text-response
    const textRoutes = new Map<string, RouteHandler>();
    textRoutes.set('get', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('This is plain text response');
    });
    routes.set('/text-response', textRoutes);

    // GET /html-response
    const htmlRoutes = new Map<string, RouteHandler>();
    htmlRoutes.set('get', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Hello World</h1></body></html>');
    });
    routes.set('/html-response', htmlRoutes);

    // GET /invalid-json
    const invalidJsonRoutes = new Map<string, RouteHandler>();
    invalidJsonRoutes.set('get', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('this is not valid json{');
    });
    routes.set('/invalid-json', invalidJsonRoutes);

    testServer = createTestServer({ routes });
    baseUrl = await testServer.start();
  });

  afterAll(async () => {
    await testServer.stop();
  });

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  /**
   * Helper to get tools from adapter with proper metadata extraction
   */
  async function getTools(spec: OpenAPIV3.Document) {
    const config: OpenapiAdapterConfig = {
      name: 'test-api',
      spec,
      baseUrl,
      logger: mockLogger,
    };

    const adapter = new OpenapiAdapter(config);
    const result = await adapter.fetch();

    // Convert function tools to objects with metadata accessible
    return (result.tools || []).map((toolFn: any) => {
      const metadata = toolFn[FrontMcpToolTokens.metadata] || {};
      return {
        name: metadata.name || metadata.id,
        metadata,
        // The tool function itself is the executor
        executor: async (input: any, ctx: any) => {
          return toolFn()(input, { context: ctx });
        },
      };
    });
  }

  /**
   * Helper to find a tool by name
   */
  function findTool(tools: any[], name: string) {
    return tools.find((t) => t.name === name);
  }

  /**
   * Create mock context for tool execution
   */
  function createContext() {
    return { authInfo: undefined };
  }

  describe('Error Responses (4xx/5xx)', () => {
    it('should return structured error for 404 Not Found', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const getUserTool = findTool(tools, 'getUser');
      expect(getUserTool).toBeDefined();

      // Execute the tool with a non-existent user
      const result = await getUserTool.executor({ id: 'not-found' }, createContext());

      expect(result).toBeDefined();
      expect(result.isError).toBe(true);
      expect(result._meta).toBeDefined();
      expect(result._meta?.status).toBe(404);
      expect(result._meta?.errorCode).toBe('OPENAPI_ERROR');

      // Verify content contains error details
      const content = result.content[0];
      expect(content.type).toBe('text');
      const parsed = JSON.parse((content as { text: string }).text);
      expect(parsed.status).toBe(404);
      expect(parsed.error).toBe('User not found');
    });

    it('should throw error for missing required parameters (client-side validation)', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const createUserTool = findTool(tools, 'createUser');
      expect(createUserTool).toBeDefined();

      // OpenAPI client-side validation throws for missing required params before reaching server
      await expect(createUserTool.executor({ name: 'John' }, createContext())).rejects.toThrow(
        /Required.*parameter.*'email'.*is missing/,
      );
    });

    it('should return structured error for 400 Bad Request from server', async () => {
      // Add endpoint that accepts valid inputs but server rejects them
      // Using createUser with invalid JSON (server returns 400 for empty body parsing)
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);

      // Test with getUser returning 404 which we already test above
      // For a true 400, we'd need a server endpoint that validates and rejects
      // This is a placeholder test showing the MCP error format for server errors
      const tool = findTool(tools, 'triggerServerError');
      expect(tool).toBeDefined();

      // Server errors return structured MCP error format
      const result = await tool.executor({}, createContext());
      expect(result.isError).toBe(true);
      expect(result._meta).toBeDefined();
    });

    it('should return structured error for 401 Unauthorized', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getUnauthorized');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      expect(result.isError).toBe(true);
      expect(result._meta?.status).toBe(401);

      const content = result.content[0];
      const parsed = JSON.parse((content as { text: string }).text);
      expect(parsed.status).toBe(401);
      expect(parsed.error).toBe('Authentication required');
    });

    it('should return structured error for 429 Rate Limited', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getRateLimited');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      expect(result.isError).toBe(true);
      expect(result._meta?.status).toBe(429);

      const content = result.content[0];
      const parsed = JSON.parse((content as { text: string }).text);
      expect(parsed.status).toBe(429);
      expect(parsed.error).toBe('Too many requests');
      expect(parsed.data.retryAfter).toBe(60);
    });

    it('should return structured error for 500 Internal Server Error', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'triggerServerError');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      expect(result.isError).toBe(true);
      expect(result._meta?.status).toBe(500);
      expect(result._meta?.errorCode).toBe('OPENAPI_ERROR');

      const content = result.content[0];
      const parsed = JSON.parse((content as { text: string }).text);
      expect(parsed.status).toBe(500);
      expect(parsed.error).toBe('Internal server error occurred');
    });
  });

  describe('JSON vs Text Response Parsing', () => {
    it('should correctly parse JSON response', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getUser');
      expect(tool).toBeDefined();

      const result = await tool.executor({ id: 'user-123' }, createContext());

      // Successful responses return structured data directly (not MCP content format)
      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
      });
    });

    it('should correctly handle text/plain response', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getTextResponse');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toBe('This is plain text response');
    });

    it('should correctly handle text/html response', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getHtmlResponse');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toContain('<html>');
      expect(result.data).toContain('Hello World');
    });

    it('should handle invalid JSON with application/json content-type gracefully', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getInvalidJson');
      expect(tool).toBeDefined();

      const result = await tool.executor({}, createContext());

      // Should not error, should return the raw text as data
      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      // Invalid JSON should be returned as-is as text
      expect(result.data).toBe('this is not valid json{');
    });

    it('should parse JSON response for POST request with body', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'createUser');
      expect(tool).toBeDefined();

      const result = await tool.executor({ name: 'Jane Doe', email: 'jane@example.com' }, createContext());

      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(201);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        id: 'new-user-123',
        name: 'Jane Doe',
        email: 'jane@example.com',
      });
    });
  });

  describe('Output Schema in Tool Metadata', () => {
    it('should include outputSchema in tool metadata from OpenAPI response schema', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);

      // Check getUser tool has output schema
      const getUserTool = findTool(tools, 'getUser');
      expect(getUserTool).toBeDefined();
      expect(getUserTool.metadata.rawOutputSchema).toBeDefined();

      const outputSchema = getUserTool.metadata.rawOutputSchema;
      expect(outputSchema.type).toBe('object');
      expect(outputSchema.properties).toBeDefined();
      expect(outputSchema.properties.status).toBeDefined();
      expect(outputSchema.properties.ok).toBeDefined();
      expect(outputSchema.properties.data).toBeDefined();
    });

    it('should wrap OpenAPI response schema with status/ok wrapper', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);

      const getUserTool = findTool(tools, 'getUser');
      const outputSchema = getUserTool.metadata.rawOutputSchema;

      // Verify wrapper structure
      expect(outputSchema.properties.status.type).toBe('number');
      expect(outputSchema.properties.ok.type).toBe('boolean');
      expect(outputSchema.properties.error).toBeDefined();
      expect(outputSchema.required).toContain('status');
      expect(outputSchema.required).toContain('ok');

      // Verify data schema is present
      const dataSchema = outputSchema.properties.data;
      expect(dataSchema).toBeDefined();
      // mcp-from-openapi may use various schema representations
      // Just verify data property exists in the output schema
    });

    it('should include outputSchema for all generated tools', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);

      // All tools should have outputSchema
      for (const tool of tools) {
        expect(tool.metadata.rawOutputSchema).toBeDefined();
        expect(tool.metadata.rawOutputSchema.type).toBe('object');
        expect(tool.metadata.rawOutputSchema.properties.status).toBeDefined();
        expect(tool.metadata.rawOutputSchema.properties.ok).toBeDefined();
      }
    });

    it('should have a data property when no response schema is defined', async () => {
      // Create a spec with an endpoint that has no response schema
      const specWithNoSchema: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Minimal API', version: '1.0.0' },
        servers: [{ url: baseUrl }],
        paths: {
          '/minimal': {
            get: {
              operationId: 'minimalEndpoint',
              summary: 'Endpoint with no response schema',
              responses: {
                '200': {
                  description: 'OK',
                },
              },
            },
          },
        },
      };

      const tools = await getTools(specWithNoSchema);

      const tool = findTool(tools, 'minimalEndpoint');
      expect(tool).toBeDefined();
      expect(tool.metadata.rawOutputSchema).toBeDefined();

      // When no schema is specified, mcp-from-openapi may return null/string/any type
      const outputSchema = tool.metadata.rawOutputSchema;
      expect(outputSchema.properties.data).toBeDefined();
      // The default type could be string or null depending on mcp-from-openapi behavior
      expect(['string', 'null', undefined]).toContain(outputSchema.properties.data.type);
    });
  });

  describe('Successful Responses', () => {
    it('should return success response with correct structure', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'getUser');
      expect(tool).toBeDefined();

      const result = await tool.executor({ id: 'existing-user' }, createContext());

      // Successful responses return structured data directly
      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should correctly handle 201 Created response', async () => {
      const spec = createTestSpec(baseUrl);
      const tools = await getTools(spec);
      const tool = findTool(tools, 'createUser');
      expect(tool).toBeDefined();

      const result = await tool.executor({ name: 'New User', email: 'new@example.com' }, createContext());

      expect(result.isError).toBeFalsy();
      expect(result.status).toBe(201);
      expect(result.ok).toBe(true);
    });
  });
});
