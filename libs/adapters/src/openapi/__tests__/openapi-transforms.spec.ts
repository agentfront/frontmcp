/**
 * Tests for OpenAPI Adapter transforms and description modes
 */

import OpenapiAdapter from '../openapi.adapter';
import { basicOpenApiSpec, createMockLogger } from './fixtures';
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
      method: 'GET',
      path: '/users',
      operationId: 'getUsers',
      operationSummary: 'Get users list',
      operationDescription: 'Returns a paginated list of all users in the system',
    },
    ...overrides,
  } as McpOpenAPITool;
}

// Helper to get tool metadata from FrontMCP tool wrapper
// The SDK stores metadata using FrontMcpToolTokens.metadata symbol key
function getToolMeta(tool: any): any {
  return tool[FrontMcpToolTokens.metadata] || {};
}

describe('OpenapiAdapter - Description Modes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use summaryOnly mode by default (no transform)', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'summaryOnly',
    });

    const result = await adapter.fetch();

    // summaryOnly mode returns tool unchanged - check metadata
    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Get all users');
  });

  it('should apply descriptionOnly mode', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'descriptionOnly',
    });

    const result = await adapter.fetch();

    // descriptionOnly uses operationDescription
    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Returns a paginated list of all users in the system');
  });

  it('should fallback to summary when description missing in descriptionOnly mode', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'GET',
        path: '/users',
        operationId: 'getUsers',
        operationSummary: 'Get users list',
        // No operationDescription
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'descriptionOnly',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Get users list');
  });

  it('should fallback to method+path when both missing in descriptionOnly mode', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'GET',
        path: '/users',
        operationId: 'getUsers',
        // No summary or description
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'descriptionOnly',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('GET /users');
  });

  it('should apply combined mode with both summary and description', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'combined',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Get users list\n\nReturns a paginated list of all users in the system');
  });

  it('should handle combined mode with only summary', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'GET',
        path: '/users',
        operationSummary: 'Get users list',
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'combined',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Get users list');
  });

  it('should apply full mode with all parts', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'full',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toContain('Get users list');
    expect(meta.description).toContain('Returns a paginated list of all users in the system');
    expect(meta.description).toContain('Operation: getUsers');
    expect(meta.description).toContain('GET /users');
  });

  it('should not duplicate summary and description in full mode when equal', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'GET',
        path: '/users',
        operationId: 'getUsers',
        operationSummary: 'Get users',
        operationDescription: 'Get users', // Same as summary
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      descriptionMode: 'full',
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    // Should only have one "Get users" not two
    const matches = meta.description.match(/Get users/g);
    expect(matches?.length).toBe(1);
  });
});

describe('OpenapiAdapter - Tool Transforms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply global tool transforms', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          annotations: { audience: ['admin'] },
          tags: ['api'],
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.annotations?.audience).toEqual(['admin']);
    expect(meta.tags).toContain('api');
  });

  it('should apply per-tool transforms that override global', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          annotations: { audience: ['admin'] },
          tags: ['api'],
        },
        perTool: {
          get_users: {
            name: 'list_users',
            description: 'Custom description',
            annotations: { priority: 'high' },
            tags: ['users'],
          },
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.name).toBe('list_users');
    expect(meta.description).toBe('Custom description');
    expect(meta.annotations?.audience).toEqual(['admin']); // Global preserved
    expect(meta.annotations?.priority).toBe('high'); // Per-tool added
    expect(meta.tags).toContain('api'); // Global preserved
    expect(meta.tags).toContain('users'); // Per-tool added
  });

  it('should apply generator transforms that override per-tool', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          name: 'global_name',
        },
        perTool: {
          get_users: {
            name: 'per_tool_name',
          },
        },
        generator: (tool) => ({
          name: `generated_${tool.name}`,
          annotations: { generated: true },
        }),
      },
    });

    const result = await adapter.fetch();

    // Generator overrides per-tool which overrides global
    const meta = getToolMeta(result.tools[0]);
    expect(meta.name).toBe('generated_get_users');
    expect(meta.annotations?.generated).toBe(true);
  });

  it('should apply name transform as function', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          name: (originalName) => `prefix_${originalName}`,
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.name).toBe('prefix_get_users');
  });

  it('should apply description transform as function', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          description: (original, tool) => `${original} (${tool.name})`,
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.description).toBe('Get all users (get_users)');
  });

  it('should handle hideFromDiscovery in per-tool transforms', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        perTool: {
          get_users: {
            hideFromDiscovery: true,
          },
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.hideFromDiscovery).toBe(true);
  });

  it('should handle examples in transforms', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          examples: [{ description: 'Example 1', input: { limit: 10 } }],
        },
        perTool: {
          get_users: {
            examples: [{ description: 'Example 2', input: { limit: 20 } }],
          },
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.examples).toHaveLength(2);
    expect(meta.examples[0].description).toBe('Example 1');
    expect(meta.examples[1].description).toBe('Example 2');
  });

  it('should handle generator returning null', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        global: {
          name: 'global_name',
        },
        generator: () => null as any,
      },
    });

    const result = await adapter.fetch();

    // Should still apply global transform
    const meta = getToolMeta(result.tools[0]);
    expect(meta.name).toBe('global_name');
  });

  it('should return tool unchanged when no transforms match', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      toolTransforms: {
        perTool: {
          other_tool: {
            name: 'renamed',
          },
        },
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    expect(meta.name).toBe('get_users');
  });
});

describe('OpenapiAdapter - Input Transforms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply global input transforms and remove key from schema', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          offset: { type: 'number' },
          tenant_id: { type: 'string' },
        },
        required: ['limit', 'tenant_id'],
      },
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      inputTransforms: {
        global: [
          {
            inputKey: 'tenant_id',
            resolver: (ctx) => ctx.authInfo?.user?.tenantId,
          },
        ],
      },
    });

    const result = await adapter.fetch();

    // Check the tool's raw input schema stored in metadata
    const meta = getToolMeta(result.tools[0]);
    expect(meta.rawInputSchema?.properties?.tenant_id).toBeUndefined();
    expect(meta.rawInputSchema?.required).not.toContain('tenant_id');
  });

  it('should throw error for reserved inputKey __proto__', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      inputTransforms: {
        global: [
          {
            inputKey: '__proto__',
            resolver: () => 'value',
          },
        ],
      },
    });

    await expect(adapter.fetch()).rejects.toThrow(
      "Invalid inputKey '__proto__' in tool 'get_users': reserved keys (__proto__, constructor, prototype) cannot be used",
    );
  });

  it('should throw error for reserved inputKey constructor', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      inputTransforms: {
        global: [
          {
            inputKey: 'constructor',
            resolver: () => 'value',
          },
        ],
      },
    });

    await expect(adapter.fetch()).rejects.toThrow("Invalid inputKey 'constructor'");
  });

  it('should throw error for reserved inputKey prototype', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool();
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      inputTransforms: {
        global: [
          {
            inputKey: 'prototype',
            resolver: () => 'value',
          },
        ],
      },
    });

    await expect(adapter.fetch()).rejects.toThrow("Invalid inputKey 'prototype'");
  });
});

describe('OpenapiAdapter - Security Scheme Filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should filter security schemes from input', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          api_key: { type: 'string' },
          oauth_token: { type: 'string' },
        },
        required: ['api_key'],
      },
      mapper: [
        { inputKey: 'limit', location: 'query', key: 'limit' },
        { inputKey: 'api_key', location: 'header', key: 'X-API-Key', security: { scheme: 'apiKey' } },
        { inputKey: 'oauth_token', location: 'header', key: 'Authorization', security: { scheme: 'oauth2' } },
      ],
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      securitySchemesInInput: ['apiKey'], // Only apiKey in input, oauth2 from context
      authProviderMapper: {
        oauth2: () => 'oauth-token',
      },
    });

    const result = await adapter.fetch();

    const meta = getToolMeta(result.tools[0]);
    // apiKey should remain in input
    expect(meta.rawInputSchema?.properties?.api_key).toBeDefined();
    // oauth2 should be removed from input
    expect(meta.rawInputSchema?.properties?.oauth_token).toBeUndefined();
  });

  it('should return tool unchanged when no security mappers match filter', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      mapper: [{ inputKey: 'limit', location: 'query', key: 'limit' }],
    });
    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([mockTool]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      logger: createMockLogger(),
      securitySchemesInInput: ['apiKey'],
    });

    const result = await adapter.fetch();

    expect(result.tools.length).toBe(1);
  });
});

describe('OpenapiAdapter - Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use console logger when no logger provided', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
      // No logger provided
    });

    await adapter.fetch();

    // Console should be used for logging
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should use setLogger to override logger', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([]),
    };
    OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

    const mockLogger = createMockLogger();
    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      spec: basicOpenApiSpec,
    });

    // Set logger via SDK method
    adapter.setLogger(mockLogger);

    await adapter.fetch();

    expect(mockLogger.info).toHaveBeenCalled();
  });
});

describe('OpenapiAdapter - URL Loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should load from URL with load options', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockGenerator = {
      generateTools: jest.fn().mockResolvedValue([]),
    };
    OpenAPIToolGenerator.fromURL.mockResolvedValue(mockGenerator);

    const adapter = new OpenapiAdapter({
      name: 'test-api',
      baseUrl: 'https://api.example.com',
      url: 'https://api.example.com/openapi.json',
      logger: createMockLogger(),
      loadOptions: {
        validate: false,
        headers: { Authorization: 'Bearer token' },
        timeout: 5000,
        followRedirects: true,
      },
    });

    await adapter.fetch();

    expect(OpenAPIToolGenerator.fromURL).toHaveBeenCalledWith(
      'https://api.example.com/openapi.json',
      expect.objectContaining({
        baseUrl: 'https://api.example.com',
        validate: false,
        headers: { Authorization: 'Bearer token' },
        timeout: 5000,
        followRedirects: true,
      }),
    );
  });
});
