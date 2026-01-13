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
      method: 'get',
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getToolMeta(tool: any): any {
  return tool[FrontMcpToolTokens.metadata] || {};
}

// Helper to get first tool from result with assertion
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFirstTool(result: { tools?: any[] }): any {
  expect(result.tools).toBeDefined();
  expect(result.tools!.length).toBeGreaterThan(0);
  return result.tools![0];
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
    const meta = getToolMeta(getFirstTool(result));
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
    const meta = getToolMeta(getFirstTool(result));
    expect(meta.description).toBe('Returns a paginated list of all users in the system');
  });

  it('should fallback to summary when description missing in descriptionOnly mode', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'get',
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

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.description).toBe('Get users list');
  });

  it('should fallback to method+path when both missing in descriptionOnly mode', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'get',
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.description).toBe('Get users list\n\nReturns a paginated list of all users in the system');
  });

  it('should handle combined mode with only summary', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'get',
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
    expect(meta.description).toContain('Get users list');
    expect(meta.description).toContain('Returns a paginated list of all users in the system');
    expect(meta.description).toContain('Operation: getUsers');
    expect(meta.description).toContain('GET /users');
  });

  it('should not duplicate summary and description in full mode when equal', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      metadata: {
        method: 'get',
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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
    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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
    const meta = getToolMeta(getFirstTool(result));
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

    const meta = getToolMeta(getFirstTool(result));
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
            inject: (transformCtx) => (transformCtx.ctx.authInfo?.user as Record<string, unknown>)?.['tenantId'],
          },
        ],
      },
    });

    const result = await adapter.fetch();

    // Check the tool's raw input schema stored in metadata
    const meta = getToolMeta(getFirstTool(result));
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
            inject: () => 'value',
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
            inject: () => 'value',
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
            inject: () => 'value',
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
        { inputKey: 'limit', type: 'query', key: 'limit', required: false },
        {
          inputKey: 'api_key',
          type: 'header',
          key: 'X-API-Key',
          required: true,
          security: { scheme: 'apiKey', type: 'apiKey' },
        },
        {
          inputKey: 'oauth_token',
          type: 'header',
          key: 'Authorization',
          required: false,
          security: { scheme: 'oauth2', type: 'oauth2' },
        },
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

    const meta = getToolMeta(getFirstTool(result));
    // apiKey should remain in input
    expect(meta.rawInputSchema?.properties?.api_key).toBeDefined();
    // oauth2 should be removed from input
    expect(meta.rawInputSchema?.properties?.oauth_token).toBeUndefined();
  });

  it('should return tool unchanged when no security mappers match filter', async () => {
    const { OpenAPIToolGenerator } = require('mcp-from-openapi');

    const mockTool = createMockTool({
      mapper: [{ inputKey: 'limit', type: 'query', key: 'limit', required: false }],
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

    expect(result.tools?.length).toBe(1);
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

describe('OpenapiAdapter - Output Transforms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('outputSchema options', () => {
    it('should not modify description with definition mode (default)', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
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
        outputSchema: {
          mode: 'definition',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toBe('Get all users');
      expect(meta.description).not.toContain('Output Schema');
    });

    it('should add JSON Schema to description with jsonSchema format', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'jsonSchema',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Get all users');
      expect(meta.description).toContain('## Output Schema');
      expect(meta.description).toContain('```json');
      expect(meta.description).toContain('"type": "object"');
    });

    it('should add human-readable summary with summary format', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'User identifier' },
            name: { type: 'string' },
          },
          required: ['id'],
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Get all users');
      expect(meta.description).toContain('## Returns');
      expect(meta.description).toContain('**id**');
      expect(meta.description).toContain('(required)');
      expect(meta.description).toContain('User identifier');
    });

    it('should add summary to description with description mode', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
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
        outputSchema: {
          mode: 'description',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Get all users');
      expect(meta.description).toContain('## Returns');
      expect(meta.description).toContain('**id**');
    });

    it('should handle array schemas in summary format', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'array',
          items: { type: 'string' },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Array of string');
    });

    it('should use custom descriptionFormatter function', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
          descriptionFormatter: (schema) => `Custom format: ${schema.type}`,
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Custom format: object');
    });

    it('should support async descriptionFormatter', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
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
        outputSchema: {
          mode: 'both',
          descriptionFormatter: async (schema) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return `Async format: ${schema.type}`;
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Async format: object');
    });

    it('should handle missing outputSchema gracefully', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: undefined,
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'jsonSchema',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toBe('Get all users');
      expect(meta.description).not.toContain('Output Schema');
    });
  });

  describe('preToolTransforms', () => {
    it('should apply global preToolTransform to schema', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            _internal: { type: 'string' },
          },
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
        outputTransforms: {
          preToolTransforms: {
            global: {
              transformSchema: (schema) => {
                if (!schema || schema.type !== 'object') return schema;
                const { _internal, ...rest } = schema.properties || {};
                return { ...schema, properties: rest };
              },
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      // The rawOutputSchema is wrapped, check that the transform was applied
      expect(meta.rawOutputSchema).toBeDefined();
    });

    it('should apply preToolTransform to description', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: { type: 'string' },
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
        outputTransforms: {
          preToolTransforms: {
            global: {
              transformDescription: (desc, schema) => `${desc} [Output: ${schema?.type || 'unknown'}]`,
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toBe('Get all users [Output: string]');
    });

    it('should apply perTool preToolTransform', async () => {
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
        outputTransforms: {
          preToolTransforms: {
            perTool: {
              get_users: {
                transformDescription: (desc) => `${desc} (per-tool transform)`,
              },
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toBe('Get all users (per-tool transform)');
    });

    it('should apply generator preToolTransform', async () => {
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
        outputTransforms: {
          preToolTransforms: {
            generator: (tool) => ({
              transformDescription: (desc) => `${desc} (generated for ${tool.name})`,
            }),
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toBe('Get all users (generated for get_users)');
    });

    it('should allow removing outputSchema via transformSchema returning undefined', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
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
        outputTransforms: {
          preToolTransforms: {
            global: {
              transformSchema: () => undefined,
              transformDescription: (desc, schema) =>
                schema ? `${desc}\n\nOutput: ${JSON.stringify(schema)}` : `${desc}\n\nNo output schema`,
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('No output schema');
    });
  });

  describe('postToolTransforms', () => {
    it('should store postToolTransform in metadata for runtime use', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool();
      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const transformFn = jest.fn((data) => ({ transformed: true, original: data }));

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
        outputTransforms: {
          postToolTransforms: {
            global: {
              transform: transformFn,
            },
          },
        },
      });

      const result = await adapter.fetch();

      // Post-tool transform should be stored in metadata (accessed internally)
      expect(result.tools).toHaveLength(1);
      // Transform function is stored and will be called at runtime
    });

    it('should apply perTool postToolTransform', async () => {
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
        outputTransforms: {
          postToolTransforms: {
            perTool: {
              get_users: {
                transform: (data) => (data as { users?: unknown[] })?.users ?? data,
              },
            },
          },
        },
      });

      const result = await adapter.fetch();

      expect(result.tools).toHaveLength(1);
    });

    it('should apply generator postToolTransform', async () => {
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
        outputTransforms: {
          postToolTransforms: {
            generator: (tool) => {
              if (tool.metadata.method === 'get') {
                return {
                  transform: (data) => ({ data, _meta: { cached: true } }),
                };
              }
              return undefined;
            },
          },
        },
      });

      const result = await adapter.fetch();

      expect(result.tools).toHaveLength(1);
    });
  });

  describe('combined transforms', () => {
    it('should apply outputSchema options and dataTransforms together', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
        dataTransforms: {
          preToolTransforms: {
            global: {
              transformDescription: (desc) => `[API] ${desc}`,
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      // Built-in mode applied first, then custom transform
      expect(meta.description).toContain('[API]');
      expect(meta.description).toContain('## Returns');
    });

    it('should apply preToolTransforms.transformSchema with context', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            secret: { type: 'string' },
          },
        },
      });
      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const transformSchemaFn = jest.fn((schema, ctx) => {
        // Verify context is passed correctly
        expect(ctx.tool.name).toBe('get_users');
        expect(ctx.adapterOptions.name).toBe('test-api');
        // Remove secret field
        if (schema?.type === 'object' && schema.properties) {
          const { secret, ...rest } = schema.properties;
          return { ...schema, properties: rest };
        }
        return schema;
      });

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
        outputTransforms: {
          preToolTransforms: {
            global: {
              transformSchema: transformSchemaFn,
            },
          },
        },
      });

      const result = await adapter.fetch();

      expect(transformSchemaFn).toHaveBeenCalled();
      expect(result.tools?.length).toBe(1);
    });

    it('should store postToolTransform in metadata when modified', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      });
      const mockGenerator = {
        generateTools: jest.fn().mockResolvedValue([mockTool]),
      };
      OpenAPIToolGenerator.fromJSON.mockResolvedValue(mockGenerator);

      const transformFn = jest.fn((data) => ({ transformed: true, data }));

      const adapter = new OpenapiAdapter({
        name: 'test-api',
        baseUrl: 'https://api.example.com',
        spec: basicOpenApiSpec,
        logger: createMockLogger(),
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
        dataTransforms: {
          postToolTransforms: {
            global: {
              transform: transformFn,
            },
          },
        },
      });

      const result = await adapter.fetch();

      // The tool should be created with transforms applied
      expect(result.tools?.length).toBe(1);
      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('## Returns');
    });

    it('should not modify tool when outputSchema has no effect', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: undefined, // No output schema
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary', // No effect without schema
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      // Description should remain unchanged
      expect(meta.description).toBe('Get all users');
    });

    it('should apply both transformSchema and transformDescription together', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
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
        outputTransforms: {
          preToolTransforms: {
            global: {
              transformSchema: (schema) => {
                // Modify schema
                return { ...schema, title: 'ModifiedSchema' };
              },
              transformDescription: (desc, schema) => {
                // Use modified schema in description
                return `${desc} [Schema: ${schema?.title || 'none'}]`;
              },
            },
          },
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('[Schema: ModifiedSchema]');
    });

    it('should handle objects with many properties in summary mode', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            address: { type: 'string' },
          },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      // Should list all properties in summary mode
      expect(meta.description).toContain('**id**');
      expect(meta.description).toContain('**name**');
    });

    it('should handle array of objects in summary mode', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'array',
          items: {
            type: 'object',
            title: 'User',
            properties: { id: { type: 'string' } },
          },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('Array of User');
    });

    it('should handle union types (array of types)', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        // JSON Schema allows type arrays for union types - cast to bypass strict typing
        outputSchema: {
          type: ['string', 'null'] as unknown as 'string',
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('string | null');
    });

    it('should handle schema without type in summary mode', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          // No type specified
          description: 'Some value',
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      expect(meta.description).toContain('any');
    });

    it('should handle nested array type in summary mode', async () => {
      const { OpenAPIToolGenerator } = require('mcp-from-openapi');

      const mockTool = createMockTool({
        outputSchema: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'string' },
          },
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
        outputSchema: {
          mode: 'both',
          descriptionFormat: 'summary',
        },
      });

      const result = await adapter.fetch();

      const meta = getToolMeta(getFirstTool(result));
      // Summary mode shows "Array of X" format
      expect(meta.description).toContain('Array of string[]');
    });
  });
});
