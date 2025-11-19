import { OpenAPIToolGenerator } from '../generator';
import { ParameterResolver } from '../parameter-resolver';
import { ResponseBuilder } from '../response-builder';
import { ParseError } from '../errors';
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
      expect(tool.mapper).toHaveLength(5); // path id, query id, body id, body name

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
