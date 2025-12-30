import { OpenAPIToolGenerator } from '../generator';
import { ParameterResolver } from '../parameter-resolver';
import { ResponseBuilder } from '../response-builder';
import { ParseError, LoadError } from '../errors';
import type { OpenAPIDocument } from '../types';

describe('OpenAPIToolGenerator', () => {
  const simpleOpenAPI: OpenAPIDocument = {
    openapi: '3.0.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
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

  describe('Factory Methods', () => {
    it('should create from JSON object', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI);
      expect(generator).toBeInstanceOf(OpenAPIToolGenerator);
      expect(generator.getDocument()).toEqual(simpleOpenAPI);
    });

    it('should create from YAML string', async () => {
      const yaml = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /test:
    get:
      operationId: test
      responses:
        '200':
          description: OK
`;
      const generator = await OpenAPIToolGenerator.fromYAML(yaml);
      expect(generator).toBeInstanceOf(OpenAPIToolGenerator);
      expect(generator.getDocument().info.title).toBe('Test API');
    });

    it('should throw ParseError on invalid YAML', async () => {
      const invalidYaml = 'invalid: yaml: content:';
      await expect(OpenAPIToolGenerator.fromYAML(invalidYaml)).rejects.toThrow(ParseError);
    });
  });

  describe('URL Loading', () => {
    const mockFetch = jest.fn();
    const originalFetch = global.fetch;

    beforeEach(() => {
      jest.useFakeTimers();
      global.fetch = mockFetch;
      mockFetch.mockReset();
    });

    afterEach(() => {
      jest.useRealTimers();
      global.fetch = originalFetch;
    });

    it('should load from URL with JSON content', async () => {
      const jsonSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'URL API', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonSpec),
        headers: new Map([['content-type', 'application/json']]),
      });

      const generator = await OpenAPIToolGenerator.fromURL('https://example.com/api.json');
      expect(generator.getDocument().info.title).toBe('URL API');
    });

    it('should load YAML from URL based on content-type', async () => {
      const yamlSpec = `
openapi: '3.0.0'
info:
  title: YAML API
  version: '1.0.0'
paths:
  /test:
    get:
      operationId: test
      responses:
        '200':
          description: OK
`;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlSpec),
        headers: new Map([['content-type', 'application/yaml']]),
      });

      const generator = await OpenAPIToolGenerator.fromURL('https://example.com/api', { validate: false });
      expect(generator.getDocument().info.title).toBe('YAML API');
    });

    it('should load YAML from URL based on URL extension', async () => {
      const yamlSpec = `
openapi: '3.0.0'
info:
  title: YAML Ext API
  version: '1.0.0'
paths:
  /test:
    get:
      operationId: test
      responses:
        '200':
          description: OK
`;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlSpec),
        headers: new Map([['content-type', 'text/plain']]),
      });

      const generator = await OpenAPIToolGenerator.fromURL('https://example.com/api.yaml', { validate: false });
      expect(generator.getDocument().info.title).toBe('YAML Ext API');
    });

    it('should throw LoadError on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(OpenAPIToolGenerator.fromURL('https://example.com/api.json')).rejects.toThrow(LoadError);

      // Verify error message contains status information
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      await expect(OpenAPIToolGenerator.fromURL('https://example.com/api.json')).rejects.toMatchObject({
        message: expect.stringContaining('404'),
      });
    });

    it('should throw LoadError on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(OpenAPIToolGenerator.fromURL('https://example.com/api.json')).rejects.toThrow(LoadError);
    });

    it('should handle timeout option', async () => {
      const jsonSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonSpec),
        headers: new Map([['content-type', 'application/json']]),
      });

      const generator = await OpenAPIToolGenerator.fromURL('https://example.com/api.json', {
        timeout: 5000,
      });
      expect(generator).toBeInstanceOf(OpenAPIToolGenerator);
    });

    it('should pass custom headers to fetch', async () => {
      const jsonSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonSpec),
        headers: new Map([['content-type', 'application/json']]),
      });

      await OpenAPIToolGenerator.fromURL('https://example.com/api.json', {
        headers: { 'X-Custom': 'value' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api.json',
        expect.objectContaining({
          headers: { 'X-Custom': 'value' },
        }),
      );
    });

    it('should handle followRedirects option', async () => {
      const jsonSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonSpec),
        headers: new Map([['content-type', 'application/json']]),
      });

      await OpenAPIToolGenerator.fromURL('https://example.com/api.json', {
        followRedirects: false,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/api.json',
        expect.objectContaining({
          redirect: 'manual',
        }),
      );
    });

    it('should handle missing content-type header', async () => {
      const jsonSpec = JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(jsonSpec),
        headers: new Map(), // No content-type
      });

      const generator = await OpenAPIToolGenerator.fromURL('https://example.com/api.json');
      expect(generator).toBeInstanceOf(OpenAPIToolGenerator);
    });
  });

  describe('File Loading', () => {
    // Note: File loading tests are skipped by default since they require actual fs mocking
    // The fromFile method is tested through the error case which doesn't need mocking

    it('should throw LoadError on file read error', async () => {
      await expect(OpenAPIToolGenerator.fromFile('/nonexistent/path/api.json')).rejects.toThrow(LoadError);
    });

    it('should throw LoadError with context on file not found', async () => {
      await expect(OpenAPIToolGenerator.fromFile('/nonexistent/path/api.yaml')).rejects.toMatchObject({
        message: expect.stringContaining('Failed to load OpenAPI spec from file'),
      });
    });
  });

  describe('Custom Tool Naming', () => {
    it('should use custom toolNameGenerator when provided', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            get: {
              operationId: 'getUser',
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users/{id}', 'get', {
        namingStrategy: {
          conflictResolver: (name, loc, idx) => `${name}_${loc}_${idx}`,
          toolNameGenerator: (path, method, opId) => `custom_${method}_${opId}`,
        },
      });

      expect(tool.name).toBe('custom_get_getUser');
    });

    it('should fallback to operationId when no custom generator', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.name).toBe('listUsers');
    });

    it('should generate name from path when no operationId', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{userId}/posts': {
            get: {
              // No operationId
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi, { validate: false });
      const tool = await generator.generateTool('/users/{userId}/posts', 'get');

      expect(tool.name).toContain('users');
      expect(tool.name).toContain('posts');
    });
  });

  describe('Tool Generation', () => {
    it('should generate tool with correct structure', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI);
      const tool = await generator.generateTool('/users/{id}', 'get');

      expect(tool).toMatchObject({
        name: 'getUser',
        description: 'Get user by ID',
        metadata: {
          path: '/users/{id}',
          method: 'get',
          operationId: 'getUser',
        },
      });

      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.mapper).toHaveLength(1);
    });

    it('should generate all tools', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI);
      const tools = await generator.generateTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('getUser');
    });

    it('should filter deprecated operations', async () => {
      const openapi: OpenAPIDocument = {
        ...simpleOpenAPI,
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              deprecated: true,
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools({ includeDeprecated: false });

      expect(tools).toHaveLength(0);
    });

    it('should include deprecated operations when configured', async () => {
      const openapi: OpenAPIDocument = {
        ...simpleOpenAPI,
        paths: {
          '/test': {
            get: {
              operationId: 'test',
              deprecated: true,
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools({ includeDeprecated: true });

      expect(tools).toHaveLength(1);
      expect(tools[0].metadata.deprecated).toBe(true);
    });
  });

  describe('Parameter Conflict Resolution', () => {
    it('should handle parameter name conflicts', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            post: {
              operationId: 'createUser',
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string' },
                },
                {
                  name: 'id',
                  in: 'query',
                  schema: { type: 'string' },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users/{id}', 'post');

      // Check that all 'id' parameters are present with different names
      expect(tool.mapper).toHaveLength(4); // path id, query id, body id, body name

      const pathParam = tool.mapper.find((m) => m.type === 'path' && m.key === 'id');
      const queryParam = tool.mapper.find((m) => m.type === 'query' && m.key === 'id');
      const bodyParam = tool.mapper.find((m) => m.type === 'body' && m.key === 'id');

      expect(pathParam).toBeDefined();
      expect(queryParam).toBeDefined();
      expect(bodyParam).toBeDefined();

      // All should have different inputKeys
      expect(pathParam!.inputKey).not.toBe(queryParam!.inputKey);
      expect(pathParam!.inputKey).not.toBe(bodyParam!.inputKey);
      expect(queryParam!.inputKey).not.toBe(bodyParam!.inputKey);
    });
  });

  describe('Response Schema Generation', () => {
    it('should generate output schema for single response', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI);
      const tool = await generator.generateTool('/users/{id}', 'get');

      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema?.type).toBe('object');
      expect(tool.outputSchema?.properties).toHaveProperty('id');
      expect(tool.outputSchema?.properties).toHaveProperty('name');
    });

    it('should generate union for multiple responses', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            get: {
              operationId: 'getUser',
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
                        },
                      },
                    },
                  },
                },
                '404': {
                  description: 'Not found',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: {
                          error: { type: 'string' },
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

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users/{id}', 'get');

      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema?.oneOf).toBeDefined();
      expect(tool.outputSchema?.oneOf).toHaveLength(2);
    });

    it('should handle responses with no content', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            delete: {
              operationId: 'deleteUser',
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: {
                '204': {
                  description: 'No content',
                },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users/{id}', 'delete');

      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema?.type).toBe('null');
    });
  });

  describe('Custom Naming Strategy', () => {
    it('should use custom conflict resolver', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            post: {
              operationId: 'createUser',
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                      },
                    },
                  },
                },
              },
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users/{id}', 'post', {
        namingStrategy: {
          conflictResolver: (name, location, index) => `${location}_${name}_${index}`,
        },
      });

      const pathParam = tool.mapper.find((m) => m.type === 'path');
      const bodyParam = tool.mapper.find((m) => m.type === 'body');

      expect(pathParam?.inputKey).toMatch(/^path_id_\d+$/);
      expect(bodyParam?.inputKey).toMatch(/^body_id_\d+$/);
    });

    it('should use custom tool name generator', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI);
      const tool = await generator.generateTool('/users/{id}', 'get', {
        namingStrategy: {
          conflictResolver: (name, location) => `${location}_${name}`,
          toolNameGenerator: (path, method) => `${method}_${path.replace(/\//g, '_')}`,
        },
      });

      expect(tool.name).toBe('get__users_{id}');
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract security requirements', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              name: 'X-API-Key',
              in: 'header',
            },
          },
        },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              security: [{ apiKey: [] }],
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.security).toBeDefined();
      expect(tool.metadata.security).toHaveLength(1);
      expect(tool.metadata.security![0]).toMatchObject({
        scheme: 'apiKey',
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
      });
    });

    it('should extract server information', async () => {
      const openapi: OpenAPIDocument = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        servers: [
          {
            url: 'https://api.example.com',
            description: 'Production server',
          },
        ],
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.servers).toBeDefined();
      expect(tool.metadata.servers).toHaveLength(1);
      expect(tool.metadata.servers![0].url).toBe('https://api.example.com');
    });

    it('should override servers with baseUrl option', async () => {
      const generator = await OpenAPIToolGenerator.fromJSON(simpleOpenAPI, {
        baseUrl: 'https://custom.example.com',
      });
      const tool = await generator.generateTool('/users/{id}', 'get');

      expect(tool.metadata.servers).toBeDefined();
      expect(tool.metadata.servers![0].url).toBe('https://custom.example.com');
    });
  });
});

describe('ParameterResolver', () => {
  it('should resolve simple parameters', () => {
    const resolver = new ParameterResolver();
    const { inputSchema, mapper } = resolver.resolve({
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer' },
        },
      ],
    });

    expect(inputSchema.properties).toHaveProperty('id');
    expect(inputSchema.properties).toHaveProperty('limit');
    expect(inputSchema.required).toContain('id');
    expect(mapper).toHaveLength(2);
  });

  it('should handle request body', () => {
    const resolver = new ParameterResolver();
    const { inputSchema, mapper } = resolver.resolve({
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
              required: ['name'],
            },
          },
        },
      },
    });

    expect(inputSchema.properties).toHaveProperty('name');
    expect(inputSchema.properties).toHaveProperty('email');
    expect(inputSchema.required).toContain('name');
    expect(mapper.filter((m) => m.type === 'body')).toHaveLength(2);
  });

  describe('Additional Coverage', () => {
    it('should handle non-object body (array)', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      });

      expect(inputSchema.properties).toHaveProperty('body');
      expect(mapper.find((m) => m.type === 'body')).toBeDefined();
    });

    it('should handle deprecated parameters', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        parameters: [
          {
            name: 'oldParam',
            in: 'query',
            deprecated: true,
            schema: { type: 'string' },
          },
        ],
      });

      const schema = inputSchema.properties?.oldParam as any;
      expect(schema['deprecated']).toBe(true);
    });

    it('should handle parameters with style and explode', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        parameters: [
          {
            name: 'ids',
            in: 'query',
            style: 'form',
            explode: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
      });

      const param = mapper.find((m) => m.inputKey === 'ids');
      expect(param?.style).toBe('form');
      expect(param?.explode).toBe(true);
    });

    it('should handle form-urlencoded content type', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  username: { type: 'string' },
                },
              },
            },
          },
        },
      });

      expect(inputSchema.properties).toHaveProperty('username');
    });

    it('should handle multipart/form-data content type', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
      });

      expect(inputSchema.properties).toHaveProperty('file');
    });

    it('should handle security requirements with includeSecurityInInput', () => {
      const resolver = new ParameterResolver();
      const securityRequirements = [
        { scheme: 'bearerAuth', type: 'http' as const },
        { scheme: 'apiKey', type: 'apiKey' as const, name: 'X-API-Key', in: 'header' as const },
        { scheme: 'oauth2', type: 'oauth2' as const, scopes: ['read', 'write'] },
      ];

      const { inputSchema, mapper } = resolver.resolve({ parameters: [] }, undefined, securityRequirements, true);

      expect(inputSchema.properties).toHaveProperty('bearerAuth');
      expect(inputSchema.properties).toHaveProperty('apiKey');
      expect(inputSchema.properties).toHaveProperty('oauth2');
      expect(inputSchema.required).toContain('bearerAuth');
    });

    it('should handle security requirements without includeSecurityInInput', () => {
      const resolver = new ParameterResolver();
      const securityRequirements = [{ scheme: 'bearerAuth', type: 'http' as const }];

      const { inputSchema, mapper } = resolver.resolve({ parameters: [] }, undefined, securityRequirements, false);

      // Should add to mapper but not to inputSchema
      expect(inputSchema.properties?.bearerAuth).toBeUndefined();
      expect(mapper.find((m) => m.security?.scheme === 'bearerAuth')).toBeDefined();
    });

    it('should handle HTTP security with bearerFormat', () => {
      const resolver = new ParameterResolver();
      const securityRequirements = [
        { scheme: 'jwt', type: 'http' as const, httpScheme: 'bearer', bearerFormat: 'JWT' },
      ];

      const { inputSchema, mapper } = resolver.resolve({ parameters: [] }, undefined, securityRequirements, true);

      const jwtSchema = inputSchema.properties?.jwt as any;
      expect(jwtSchema.description).toContain('JWT');
    });

    it('should handle unknown security type', () => {
      const resolver = new ParameterResolver();
      const securityRequirements = [{ scheme: 'mutualTLS', type: 'mutualTLS' as const }];

      const { mapper } = resolver.resolve({ parameters: [] }, undefined, securityRequirements, true);

      // Unknown type should be skipped
      expect(mapper.find((m) => m.security?.scheme === 'mutualTLS')).toBeUndefined();
    });

    it('should handle openIdConnect security type', () => {
      const resolver = new ParameterResolver();
      const securityRequirements = [{ scheme: 'oidc', type: 'openIdConnect' as const, scopes: ['openid', 'profile'] }];

      const { inputSchema, mapper } = resolver.resolve({ parameters: [] }, undefined, securityRequirements, true);

      const oidcSchema = inputSchema.properties?.oidc as any;
      expect(oidcSchema.description).toContain('openid, profile');
    });

    it('should use fallback content type when none match preferences', () => {
      const resolver = new ParameterResolver();
      const { inputSchema, mapper } = resolver.resolve({
        requestBody: {
          required: true,
          content: {
            'application/custom-type': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'string' },
                },
              },
            },
          },
        },
      });

      expect(inputSchema.properties).toHaveProperty('data');
    });
  });
});

describe('OpenAPIToolGenerator - Additional Coverage', () => {
  describe('Operation Filtering', () => {
    it('should filter by includeOperations', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/a': {
            get: {
              operationId: 'opA',
              responses: { '200': { description: 'OK' } },
            },
          },
          '/b': {
            get: {
              operationId: 'opB',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools({ includeOperations: ['opA'] });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('opA');
    });

    it('should filter by excludeOperations', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/a': {
            get: {
              operationId: 'opA',
              responses: { '200': { description: 'OK' } },
            },
          },
          '/b': {
            get: {
              operationId: 'opB',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools({ excludeOperations: ['opA'] });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('opB');
    });

    it('should filter by custom filterFn', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              tags: ['users'],
              responses: { '200': { description: 'OK' } },
            },
          },
          '/admin': {
            get: {
              operationId: 'getAdmin',
              tags: ['admin'],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools({
        filterFn: (op) => op.tags?.includes('users') ?? false,
      });

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('getUsers');
    });
  });

  describe('Tool Name Generation', () => {
    it('should generate name from path when operationId is missing', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{userId}/posts': {
            get: {
              parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tools = await generator.generateTools();

      expect(tools[0].name).toMatch(/^get_users_By_userId_posts$/);
    });
  });

  describe('Security Requirements Extraction', () => {
    it('should extract HTTP bearer authentication with bearerFormat', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'JWT Bearer token',
            },
          },
        },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              security: [{ bearerAuth: [] }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.security).toBeDefined();
      expect(tool.metadata.security![0].httpScheme).toBe('bearer');
      expect(tool.metadata.security![0].bearerFormat).toBe('JWT');
      expect(tool.metadata.security![0].description).toBe('JWT Bearer token');
    });

    it('should handle security reference object', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          securitySchemes: {
            refAuth: {
              $ref: '#/components/securitySchemes/otherAuth',
            },
            otherAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
        },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              security: [{ refAuth: [] }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      // Should handle reference with default type
      expect(tool.metadata.security).toBeDefined();
      expect(tool.metadata.security![0].type).toBe('http');
    });

    it('should use global security when operation security is not defined', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        security: [{ apiKey: [] }],
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              name: 'X-API-Key',
              in: 'header',
            },
          },
        },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.security).toBeDefined();
      expect(tool.metadata.security![0].type).toBe('apiKey');
    });
  });

  describe('Metadata Extraction', () => {
    it('should extract external docs', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              externalDocs: {
                url: 'https://docs.example.com/users',
                description: 'User API documentation',
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.externalDocs).toBeDefined();
      expect(tool.metadata.externalDocs?.url).toBe('https://docs.example.com/users');
    });

    it('should extract x-frontmcp extension', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              'x-frontmcp': {
                annotations: {
                  readOnlyHint: true,
                  destructiveHint: false,
                },
                cache: {
                  ttl: 60,
                },
              },
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.frontmcp).toBeDefined();
      expect(tool.metadata.frontmcp?.annotations?.readOnlyHint).toBe(true);
      expect(tool.metadata.frontmcp?.cache?.ttl).toBe(60);
    });

    it('should extract response status codes from oneOf', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: {
                '200': {
                  description: 'OK',
                  content: { 'application/json': { schema: { type: 'object' } } },
                },
                '404': {
                  description: 'Not Found',
                  content: { 'application/json': { schema: { type: 'object' } } },
                },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get', { includeAllResponses: true });

      expect(tool.metadata.responseStatusCodes).toBeDefined();
      expect(tool.metadata.responseStatusCodes).toContain(200);
      expect(tool.metadata.responseStatusCodes).toContain(404);
    });

    it('should use operation servers over document servers', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        servers: [{ url: 'https://api.example.com' }],
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              servers: [{ url: 'https://special.example.com', description: 'Special server' }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const tool = await generator.generateTool('/users', 'get');

      expect(tool.metadata.servers).toBeDefined();
      expect(tool.metadata.servers![0].url).toBe('https://special.example.com');
    });
  });

  describe('Path Parameters Handling', () => {
    it('should handle path-level parameters', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users/{id}': {
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            get: {
              operationId: 'getUser',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      // Use validate: false since path-level params aren't checked by the simple validator
      const generator = await OpenAPIToolGenerator.fromJSON(openapi, { validate: false });
      const tool = await generator.generateTool('/users/{id}', 'get');

      expect(tool.mapper).toHaveLength(1);
      expect(tool.mapper[0].key).toBe('id');
      expect(tool.mapper[0].type).toBe('path');
    });

    it('should skip path with $ref', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/ref': { $ref: '#/components/pathItems/refPath' },
          '/normal': {
            get: {
              operationId: 'normalOp',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: {
          pathItems: {
            refPath: {
              get: {
                operationId: 'refOp',
                responses: { '200': { description: 'OK' } },
              },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi, { dereference: false });
      const tools = await generator.generateTools();

      // With dereference: false, the $ref path should be skipped
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('normalOp');
    });
  });

  describe('Error Handling', () => {
    it('should throw error when operation not found', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);

      await expect(generator.generateTool('/users', 'post')).rejects.toThrow('Operation not found');
    });

    it('should throw error when no paths defined', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi, { validate: false });

      await expect(generator.generateTool('/users', 'get')).rejects.toThrow('No paths defined');
    });

    it('should return empty tools when no paths', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi, { validate: false });
      const tools = await generator.generateTools();

      expect(tools).toEqual([]);
    });

    it('should warn and continue when tool generation fails', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);

      // Mock generateTool to fail
      const origGenerate = generator.generateTool.bind(generator);
      let first = true;
      jest.spyOn(generator, 'generateTool').mockImplementation(async (...args) => {
        if (first) {
          first = false;
          throw new Error('Simulated failure');
        }
        return origGenerate(...args);
      });

      const tools = await generator.generateTools();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to generate tool'), expect.any(String));

      consoleSpy.mockRestore();
    });
  });

  describe('Validation', () => {
    it('should validate document and return result', async () => {
      const openapi = {
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };

      const generator = await OpenAPIToolGenerator.fromJSON(openapi);
      const result = await generator.validate();

      expect(result.valid).toBe(true);
    });

    it('should throw ParseError for invalid document during initialization', async () => {
      const invalidOpenapi = {
        openapi: '2.0.0', // Invalid version
        info: { title: 'Test', version: '1.0.0' },
        paths: {},
      };

      const generator = await OpenAPIToolGenerator.fromJSON(invalidOpenapi);

      await expect(generator.generateTools()).rejects.toThrow(ParseError);
    });
  });
});

describe('ResponseBuilder', () => {
  it('should build schema from single response', () => {
    const builder = new ResponseBuilder();
    const schema = builder.build({
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      },
    });

    expect(schema).toBeDefined();
    expect(schema?.type).toBe('object');
    expect(schema?.properties).toHaveProperty('id');
  });

  it('should prefer specified status codes', () => {
    const builder = new ResponseBuilder({
      preferredStatusCodes: [201],
      includeAllResponses: false,
    });

    const schema = builder.build({
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { status: { type: 'string' } } },
          },
        },
      },
      '201': {
        description: 'Created',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      },
    });

    expect(schema).toBeDefined();
    expect((schema as any)['x-status-code']).toBe(201);
    expect(schema?.properties).toHaveProperty('id');
  });

  it('should create union for multiple responses', () => {
    const builder = new ResponseBuilder({ includeAllResponses: true });
    const schema = builder.build({
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { data: { type: 'string' } } },
          },
        },
      },
      '400': {
        description: 'Error',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { error: { type: 'string' } } },
          },
        },
      },
    });

    expect(schema?.oneOf).toBeDefined();
    expect(schema?.oneOf).toHaveLength(2);
  });
});
