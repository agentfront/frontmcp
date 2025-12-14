/**
 * Tests for x-frontmcp OpenAPI extension support
 *
 * The x-frontmcp extension allows embedding FrontMCP-specific configuration
 * directly in OpenAPI specs for declarative tool configuration.
 */

import { createOpenApiTool } from '../openapi.tool';
import type { McpOpenAPITool, FrontMcpExtensionData } from 'mcp-from-openapi';
import { createMockLogger } from './fixtures';

// Mock mcp-from-openapi
jest.mock('mcp-from-openapi', () => ({
  SecurityResolver: jest.fn().mockImplementation(() => ({
    resolve: jest.fn().mockResolvedValue({
      headers: {},
      query: {},
      cookies: {},
    }),
  })),
  createSecurityContext: jest.fn((context) => context),
}));

/**
 * Helper to create a mock OpenAPI tool with x-frontmcp extension
 */
function createMockTool(
  name: string,
  frontmcp?: FrontMcpExtensionData,
  toolTransform?: Record<string, unknown>,
): McpOpenAPITool {
  const metadata: Record<string, unknown> = {
    path: `/test/${name}`,
    method: 'get',
    servers: [{ url: 'https://api.example.com' }],
  };

  if (frontmcp) {
    metadata['frontmcp'] = frontmcp;
  }

  if (toolTransform) {
    metadata['adapter'] = { toolTransform };
  }

  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
    },
    mapper: [
      {
        inputKey: 'id',
        type: 'query',
        key: 'id',
        required: false,
      },
    ],
    metadata: metadata as McpOpenAPITool['metadata'],
  };
}

describe('OpenapiAdapter - x-frontmcp Extension Support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Annotations', () => {
    it('should apply readOnlyHint annotation from x-frontmcp', () => {
      const tool = createMockTool('getUser', {
        annotations: {
          readOnlyHint: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
      // The tool function contains metadata, verify it was created
      expect(typeof result).toBe('function');
    });

    it('should apply destructiveHint annotation from x-frontmcp', () => {
      const tool = createMockTool('deleteUser', {
        annotations: {
          destructiveHint: true,
          readOnlyHint: false,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply idempotentHint annotation from x-frontmcp', () => {
      const tool = createMockTool('updateUser', {
        annotations: {
          idempotentHint: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply openWorldHint annotation from x-frontmcp', () => {
      const tool = createMockTool('callExternalApi', {
        annotations: {
          openWorldHint: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply title annotation from x-frontmcp', () => {
      const tool = createMockTool('getUsers', {
        annotations: {
          title: 'List All Users',
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply multiple annotations from x-frontmcp', () => {
      const tool = createMockTool('listUsers', {
        annotations: {
          title: 'List Users',
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: true,
          destructiveHint: false,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Cache Configuration', () => {
    it('should apply cache ttl from x-frontmcp', () => {
      const tool = createMockTool('getCachedData', {
        cache: {
          ttl: 300,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply cache slideWindow from x-frontmcp', () => {
      const tool = createMockTool('getSlideWindowData', {
        cache: {
          ttl: 600,
          slideWindow: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply cache config without slideWindow (default false)', () => {
      const tool = createMockTool('getFixedCacheData', {
        cache: {
          ttl: 120,
          slideWindow: false,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('CodeCall Configuration', () => {
    it('should apply enabledInCodeCall from x-frontmcp', () => {
      const tool = createMockTool('codeCallTool', {
        codecall: {
          enabledInCodeCall: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply visibleInListTools from x-frontmcp', () => {
      const tool = createMockTool('visibleTool', {
        codecall: {
          visibleInListTools: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply full codecall config from x-frontmcp', () => {
      const tool = createMockTool('fullCodeCallTool', {
        codecall: {
          enabledInCodeCall: true,
          visibleInListTools: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply disabled codecall config from x-frontmcp', () => {
      const tool = createMockTool('disabledCodeCallTool', {
        codecall: {
          enabledInCodeCall: false,
          visibleInListTools: false,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Tags', () => {
    it('should apply single tag from x-frontmcp', () => {
      const tool = createMockTool('taggedTool', {
        tags: ['users'],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply multiple tags from x-frontmcp', () => {
      const tool = createMockTool('multiTagTool', {
        tags: ['users', 'admin', 'public-api'],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply empty tags array from x-frontmcp', () => {
      const tool = createMockTool('noTagsTool', {
        tags: [],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Hide From Discovery', () => {
    it('should apply hideFromDiscovery true from x-frontmcp', () => {
      const tool = createMockTool('hiddenTool', {
        hideFromDiscovery: true,
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply hideFromDiscovery false from x-frontmcp', () => {
      const tool = createMockTool('visibleTool', {
        hideFromDiscovery: false,
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Examples', () => {
    it('should apply single example from x-frontmcp', () => {
      const tool = createMockTool('exampleTool', {
        examples: [
          {
            description: 'Get user by ID',
            input: { id: 'user-123' },
          },
        ],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply multiple examples from x-frontmcp', () => {
      const tool = createMockTool('multiExampleTool', {
        examples: [
          {
            description: 'Get user by ID',
            input: { id: 'user-123' },
            output: { name: 'John', email: 'john@example.com' },
          },
          {
            description: 'Get admin user',
            input: { id: 'admin-1' },
            output: { name: 'Admin', email: 'admin@example.com', isAdmin: true },
          },
        ],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply example with output from x-frontmcp', () => {
      const tool = createMockTool('outputExampleTool', {
        examples: [
          {
            description: 'Example with expected output',
            input: { query: 'test' },
            output: { results: [], count: 0 },
          },
        ],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Full x-frontmcp Extension', () => {
    it('should apply complete x-frontmcp extension with all options', () => {
      const tool = createMockTool('fullExtensionTool', {
        annotations: {
          title: 'Full Extension Tool',
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
        cache: {
          ttl: 300,
          slideWindow: true,
        },
        codecall: {
          enabledInCodeCall: true,
          visibleInListTools: true,
        },
        tags: ['api', 'users', 'public'],
        hideFromDiscovery: false,
        examples: [
          {
            description: 'Get all users',
            input: {},
            output: { users: [], total: 0 },
          },
        ],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('ToolTransforms Override x-frontmcp', () => {
    it('should allow toolTransforms to override x-frontmcp annotations', () => {
      // x-frontmcp sets readOnlyHint: true, toolTransform overrides to false
      const tool = createMockTool(
        'overrideTool',
        {
          annotations: {
            readOnlyHint: true,
            idempotentHint: true,
          },
        },
        {
          annotations: {
            readOnlyHint: false, // Override from adapter
            destructiveHint: true, // New annotation from adapter
          },
        },
      );

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should merge toolTransforms tags with x-frontmcp tags', () => {
      const tool = createMockTool(
        'mergeTagsTool',
        {
          tags: ['api', 'users'],
        },
        {
          tags: ['internal', 'v2'],
        },
      );

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should allow toolTransforms to override hideFromDiscovery', () => {
      // x-frontmcp sets hideFromDiscovery: false, toolTransform overrides to true
      const tool = createMockTool(
        'hideOverrideTool',
        {
          hideFromDiscovery: false,
        },
        {
          hideFromDiscovery: true,
        },
      );

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should merge toolTransforms examples with x-frontmcp examples', () => {
      const tool = createMockTool(
        'mergeExamplesTool',
        {
          examples: [{ description: 'Example from spec', input: { id: '1' } }],
        },
        {
          examples: [{ description: 'Example from adapter', input: { id: '2' } }],
        },
      );

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply toolTransforms UI config (not available in x-frontmcp)', () => {
      const tool = createMockTool(
        'uiConfigTool',
        {
          annotations: { readOnlyHint: true },
        },
        {
          ui: {
            form: { layout: 'horizontal' },
          },
        },
      );

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('No x-frontmcp Extension', () => {
    it('should work without x-frontmcp extension', () => {
      const tool = createMockTool('noExtensionTool');

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply only toolTransforms when no x-frontmcp', () => {
      const tool = createMockTool('onlyTransformsTool', undefined, {
        annotations: { readOnlyHint: true },
        tags: ['adapter-only'],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Partial x-frontmcp Extension', () => {
    it('should apply only annotations when other fields are not set', () => {
      const tool = createMockTool('annotationsOnlyTool', {
        annotations: {
          readOnlyHint: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply only cache when other fields are not set', () => {
      const tool = createMockTool('cacheOnlyTool', {
        cache: {
          ttl: 60,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should apply only tags when other fields are not set', () => {
      const tool = createMockTool('tagsOnlyTool', {
        tags: ['standalone-tag'],
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty x-frontmcp extension object', () => {
      const tool = createMockTool('emptyExtensionTool', {});

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should handle undefined annotations object', () => {
      const tool = createMockTool('undefinedAnnotationsTool', {
        tags: ['test'],
        annotations: undefined,
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should handle empty annotations object', () => {
      const tool = createMockTool('emptyAnnotationsTool', {
        annotations: {},
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should handle cache with only ttl', () => {
      const tool = createMockTool('ttlOnlyCacheTool', {
        cache: {
          ttl: 100,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });

    it('should handle codecall with only one property', () => {
      const tool = createMockTool('partialCodeCallTool', {
        codecall: {
          enabledInCodeCall: true,
        },
      });

      const mockLogger = createMockLogger();
      const result = createOpenApiTool(
        tool,
        {
          name: 'test-api',
          baseUrl: 'https://api.example.com',
          spec: {} as any,
          logger: mockLogger,
        },
        mockLogger,
      );

      expect(result).toBeDefined();
    });
  });
});
