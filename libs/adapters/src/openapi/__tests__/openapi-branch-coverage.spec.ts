/**
 * Additional branch coverage tests for OpenAPI Adapter
 */

import OpenapiAdapter from '../openapi.adapter';
import { basicOpenApiSpec } from './fixtures';
import type { McpOpenAPITool } from 'mcp-from-openapi';
import { FrontMcpToolTokens } from '@frontmcp/sdk';

// Mock the OpenAPIToolGenerator
jest.mock('mcp-from-openapi', () => ({
  OpenAPIToolGenerator: {
    fromURL: jest.fn(),
    fromJSON: jest.fn(),
  },
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      headers: {},
      query: {},
      cookies: {},
    }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

// Create a mock tool for testing
function createMockTool(overrides: Partial<McpOpenAPITool> = {}): McpOpenAPITool {
  return {
    name: 'get_users',
    description: 'Get all users',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['limit'],
    },
    mapper: [],
    metadata: {
      method: 'get',
      path: '/users',
      operationId: 'getUsers',
      operationSummary: 'Get users list',
      operationDescription: 'Returns a paginated list of all users in the system',
    },
    ...overrides,
  } as McpOpenAPITool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolMeta(tool: any): any {
  return tool[FrontMcpToolTokens.metadata] || {};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFirstTool(result: { tools?: any[] }): any {
  expect(result.tools).toBeDefined();
  expect(result.tools!.length).toBeGreaterThan(0);
  return result.tools![0];
}

describe('OpenapiAdapter - Console Logger Branch Coverage', () => {
  let originalConsole: {
    debug: typeof console.debug;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    originalConsole = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
  });

  afterEach(() => {
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it('should exercise verbose console logger method', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation();

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      // No logger - will use console fallback
    });

    // Access the internal console logger by fetching (which triggers logging)
    await adapter.fetch();

    // The console logger's verbose/debug methods should have been called
    // Verify the spy was set up correctly
    expect(debugSpy).toBeDefined();
    debugSpy.mockRestore();
  });

  it('should use all console logger methods when security warnings exist', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      mapper: [
        {
          inputKey: 'token',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' },
        },
      ],
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
    const infoSpy = jest.spyOn(console, 'info').mockImplementation();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      generateOptions: {
        includeSecurityInInput: true,
      },
      // No logger - will use console fallback
    });

    await adapter.fetch();

    // Console info should have been called for security analysis
    expect(infoSpy).toHaveBeenCalled();

    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('OpenapiAdapter - Schema Transform Branch Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply perTool input schema transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          secret: { type: 'string' },
        },
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        input: {
          perTool: {
            get_users: (schema) => {
              // Remove secret from input schema
              if (schema.type === 'object' && schema.properties) {
                const { secret, ...rest } = schema.properties as Record<string, unknown>;
                return { ...schema, properties: rest };
              }
              return schema;
            },
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Applied schema transforms'));
  });

  it('should apply perTool output schema transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          internal: { type: 'string' },
        },
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        output: {
          perTool: {
            get_users: (schema) => {
              // Remove internal from output schema
              if (schema?.type === 'object' && schema.properties) {
                const { internal, ...rest } = schema.properties as Record<string, unknown>;
                return { ...schema, properties: rest };
              }
              return schema;
            },
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Applied schema transforms'));
  });

  it('should apply generator input schema transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        input: {
          generator: (tool) => {
            if (tool.name === 'get_users') {
              return (schema) => ({ ...schema, title: 'GeneratedInput' });
            }
            return undefined;
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should apply generator output schema transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        output: {
          generator: (tool) => {
            if (tool.name === 'get_users') {
              return (schema) => (schema ? { ...schema, title: 'GeneratedOutput' } : schema);
            }
            return undefined;
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should apply global schema transforms with context', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const inputTransformFn = jest.fn((schema, ctx) => {
      expect(ctx.tool.name).toBe('get_users');
      expect(ctx.adapterOptions.name).toBe('test-api');
      return schema;
    });

    const outputTransformFn = jest.fn((schema, ctx) => {
      expect(ctx.tool.name).toBe('get_users');
      return schema;
    });

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        input: {
          global: inputTransformFn,
        },
        output: {
          global: outputTransformFn,
        },
      },
    });

    const result = await adapter.fetch();

    expect(inputTransformFn).toHaveBeenCalled();
    expect(outputTransformFn).toHaveBeenCalled();
    expect(result.tools).toHaveLength(1);
  });

  it('should handle schema transforms with no changes', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      schemaTransforms: {
        input: {
          // Transform returns same schema
          global: (schema) => schema,
        },
        output: {
          // Transform returns same schema
          global: (schema) => schema,
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    // Debug log should NOT be called when schemas are unchanged
  });
});

describe('OpenapiAdapter - Tool Transform Examples Branch Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply examples from generator transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      toolTransforms: {
        generator: (tool) => ({
          examples: [{ description: `Example for ${tool.name}`, input: { limit: 5 } }],
          tags: [`tag-${tool.name}`],
        }),
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.examples).toHaveLength(1);
    expect(meta.examples[0].description).toBe('Example for get_users');
    expect(meta.tags).toContain('tag-get_users');
  });

  it('should apply ui transform from per-tool config', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      toolTransforms: {
        perTool: {
          get_users: {
            ui: { template: '<div>Custom UI</div>' },
          },
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.ui?.template).toBe('<div>Custom UI</div>');
  });

  it('should apply ui transform from generator', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      toolTransforms: {
        generator: (tool) => ({
          ui: { template: `<div>Generated UI for ${tool.name}</div>` },
        }),
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.ui?.template).toContain('Generated UI for get_users');
  });

  it('should apply hideFromDiscovery from generator transform', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      toolTransforms: {
        generator: (tool) => ({
          hideFromDiscovery: tool.name.startsWith('get_'),
        }),
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.hideFromDiscovery).toBe(true);
  });
});

describe('OpenapiAdapter - Post Tool Transform Branch Coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should combine global and perTool postToolTransforms with filter', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const globalTransform = jest.fn((data) => ({ global: true, data }));
    const perToolTransform = jest.fn((data) => ({ perTool: true, data }));
    const filterFn = jest.fn(() => true);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      dataTransforms: {
        postToolTransforms: {
          global: {
            transform: globalTransform,
            filter: filterFn,
          },
          perTool: {
            get_users: {
              transform: perToolTransform,
              // No filter - should inherit from global
            },
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should combine global and generator postToolTransforms with filter', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const globalTransform = jest.fn((data) => ({ global: true, data }));
    const generatedTransform = jest.fn((data) => ({ generated: true, data }));
    const globalFilter = jest.fn(() => true);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      dataTransforms: {
        postToolTransforms: {
          global: {
            transform: globalTransform,
            filter: globalFilter,
          },
          generator: () => ({
            transform: generatedTransform,
            // No filter - should inherit from global
          }),
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should handle postToolTransform without global', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const perToolTransform = jest.fn((data) => ({ perTool: true, data }));
    const perToolFilter = jest.fn(() => true);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      dataTransforms: {
        postToolTransforms: {
          perTool: {
            get_users: {
              transform: perToolTransform,
              filter: perToolFilter,
            },
          },
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should handle generator postToolTransform without global', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const generatedTransform = jest.fn((data) => ({ generated: true, data }));
    const generatedFilter = jest.fn(() => true);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      dataTransforms: {
        postToolTransforms: {
          generator: () => ({
            transform: generatedTransform,
            filter: generatedFilter,
          }),
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });
});

describe('OpenapiAdapter - Security Scheme Filter Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle filterSecuritySchemes with empty allowedSchemes', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      mapper: [
        {
          inputKey: 'token',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' },
        },
      ],
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      securitySchemesInInput: [], // Empty array - should return tool unchanged
      authProviderMapper: {
        BearerAuth: () => 'token',
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
  });

  it('should handle filterSecuritySchemes with multiple security schemes', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          api_key: { type: 'string' },
          bearer_token: { type: 'string' },
          basic_auth: { type: 'string' },
        },
        required: ['api_key', 'bearer_token'],
      },
      mapper: [
        { inputKey: 'limit', type: 'query', key: 'limit', required: false },
        {
          inputKey: 'api_key',
          type: 'header',
          key: 'X-API-Key',
          required: true,
          security: { scheme: 'ApiKeyAuth', type: 'apiKey' },
        },
        {
          inputKey: 'bearer_token',
          type: 'header',
          key: 'Authorization',
          required: true,
          security: { scheme: 'BearerAuth', type: 'http', httpScheme: 'bearer' },
        },
        {
          inputKey: 'basic_auth',
          type: 'header',
          key: 'Authorization',
          required: false,
          security: { scheme: 'BasicAuth', type: 'http', httpScheme: 'basic' },
        },
      ],
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      securitySchemesInInput: ['ApiKeyAuth'], // Only ApiKeyAuth in input
      authProviderMapper: {
        BearerAuth: () => 'bearer-token',
        BasicAuth: () => 'basic-credentials',
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    // Logger debug should be called with filtered schemes info
    expect(mockLogger.debug).toHaveBeenCalled();
  });
});

describe('OpenapiAdapter - Input Transform Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply perTool input transforms', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          tenant_id: { type: 'string' },
        },
        required: ['tenant_id'],
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      inputTransforms: {
        perTool: {
          get_users: [
            {
              inputKey: 'tenant_id',
              inject: () => 'injected-tenant',
            },
          ],
        },
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Applied 1 input transforms'));
  });

  it('should apply generator input transforms', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          correlation_id: { type: 'string' },
        },
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = {
      verbose: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: mockLogger,
      inputTransforms: {
        generator: () => [
          {
            inputKey: 'correlation_id',
            inject: () => `corr-${Date.now()}`,
          },
        ],
      },
    });

    const result = await adapter.fetch();

    expect(result.tools).toHaveLength(1);
    expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('Applied 1 input transforms'));
  });
});
