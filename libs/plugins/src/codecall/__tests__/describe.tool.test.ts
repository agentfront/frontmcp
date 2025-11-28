// file: libs/plugins/src/codecall/__tests__/describe.tool.test.ts

import { z } from 'zod';
import DescribeTool from '../tools/describe.tool';

// Mock the SDK
jest.mock('@frontmcp/sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tool: (config: any) => (target: any) => target,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Provider: (config: any) => (target: any) => target,
  ProviderScope: { GLOBAL: 'global', REQUEST: 'request' },
  ToolContext: class MockToolContext {
    scope = {
      tools: {
        getTools: jest.fn(() => []),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    constructor(_args?: any) {
      // Mock constructor accepts optional args
    }
  },
}));

// Helper to create a mock tool
function createMockTool(overrides: {
  name: string;
  fullName?: string;
  description?: string;
  rawInputSchema?: unknown;
  outputSchema?: unknown;
  metadata?: Record<string, unknown>;
  owner?: { id?: string };
}) {
  return {
    name: overrides.name,
    fullName: overrides.fullName || overrides.name,
    rawInputSchema: overrides.rawInputSchema,
    outputSchema: overrides.outputSchema,
    metadata: {
      description: overrides.description || `Tool: ${overrides.name}`,
      ...overrides.metadata,
    },
    owner: overrides.owner,
  };
}

// Helper to create a configured DescribeTool instance
function createDescribeTool(tools: ReturnType<typeof createMockTool>[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = new (DescribeTool as any)();
  tool.scope.tools.getTools = jest.fn(() => tools);
  return tool;
}

describe('DescribeTool', () => {
  describe('Constructor Validation', () => {
    it('should instantiate DescribeTool correctly', () => {
      const tool = createDescribeTool();
      expect(tool).toBeDefined();
    });
  });

  describe('Tool Lookup', () => {
    it('should find tool by exact name', async () => {
      const mockTools = [
        createMockTool({
          name: 'users:list',
          description: 'List all users',
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:list'] });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('users:list');
      expect(result.notFound).toBeUndefined();
    });

    it('should find tool by fullName when name differs', async () => {
      const mockTools = [
        createMockTool({
          name: 'list',
          fullName: 'users:list',
          description: 'List users',
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:list'] });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('list');
    });

    it('should add to notFound when tool is missing', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: ['nonexistent:tool'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['nonexistent:tool']);
    });

    it('should handle multiple tools with some found and some not', async () => {
      const mockTools = [createMockTool({ name: 'users:list', description: 'List users' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({
        toolNames: ['users:list', 'nonexistent:tool'],
      });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('users:list');
      expect(result.notFound).toEqual(['nonexistent:tool']);
    });

    it('should find multiple tools successfully', async () => {
      const mockTools = [
        createMockTool({ name: 'users:list', description: 'List users' }),
        createMockTool({ name: 'users:get', description: 'Get user by ID' }),
        createMockTool({ name: 'billing:invoice', description: 'Get invoice' }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({
        toolNames: ['users:list', 'users:get', 'billing:invoice'],
      });

      expect(result.tools).toHaveLength(3);
      expect(result.notFound).toBeUndefined();
    });
  });

  describe('Security: Self-Reference Blocking', () => {
    it('should block codecall:execute', async () => {
      const mockTools = [createMockTool({ name: 'codecall:execute', description: 'Execute code' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['codecall:execute'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['codecall:execute']);
    });

    it('should block codecall:describe', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: ['codecall:describe'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['codecall:describe']);
    });

    it('should block codecall:search', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: ['codecall:search'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['codecall:search']);
    });

    it('should block codecall:invoke', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: ['codecall:invoke'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['codecall:invoke']);
    });

    it('should block CODECALL: (case-insensitive)', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: ['CODECALL:Execute'] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toEqual(['CODECALL:Execute']);
    });

    it('should allow non-codecall tools', async () => {
      const mockTools = [createMockTool({ name: 'users:list', description: 'List users' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:list'] });

      expect(result.tools).toHaveLength(1);
      expect(result.notFound).toBeUndefined();
    });
  });

  describe('Schema Conversion (toJsonSchema)', () => {
    it('should return null for null/undefined schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          rawInputSchema: { type: 'object' },
          outputSchema: undefined,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toBeNull();
    });

    it('should convert Zod schema to JSON Schema', async () => {
      const zodSchema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: zodSchema,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toBeDefined();
      expect(result.tools[0].outputSchema?.type).toBe('object');
      expect(result.tools[0].outputSchema?.properties).toHaveProperty('name');
      expect(result.tools[0].outputSchema?.properties).toHaveProperty('age');
    });

    it('should pass through existing JSON Schema', async () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      };

      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: jsonSchema,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toEqual(jsonSchema);
    });

    it('should detect JSON Schema by $schema property', async () => {
      const jsonSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'string',
      };

      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: jsonSchema,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toEqual(jsonSchema);
    });

    it('should detect JSON Schema by properties key', async () => {
      const jsonSchema = {
        properties: {
          data: { type: 'array' },
        },
      };

      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: jsonSchema,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toEqual(jsonSchema);
    });

    it('should return null for string literal schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: 'text',
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toBeNull();
    });

    it('should return null for array schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          outputSchema: ['text', 'json'],
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].outputSchema).toBeNull();
    });
  });

  describe('AppID Extraction', () => {
    it('should extract appId from metadata.codecall.appId', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          metadata: {
            codecall: { appId: 'my-app' },
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].appId).toBe('my-app');
    });

    it('should extract appId from metadata.source', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          metadata: {
            source: 'source-app',
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].appId).toBe('source-app');
    });

    it('should extract appId from owner.id', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          owner: { id: 'owner-app' },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      expect(result.tools[0].appId).toBe('owner-app');
    });

    it('should extract namespace from tool name as appId', async () => {
      const mockTools = [
        createMockTool({
          name: 'billing:getInvoice',
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['billing:getInvoice'] });

      expect(result.tools[0].appId).toBe('billing');
    });

    it('should return unknown for tools without appId info', async () => {
      const mockTools = [
        createMockTool({
          name: 'toolWithoutNamespace',
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['toolWithoutNamespace'] });

      expect(result.tools[0].appId).toBe('unknown');
    });

    it('should prioritize metadata.codecall.appId over other sources', async () => {
      const mockTools = [
        createMockTool({
          name: 'namespace:tool',
          metadata: {
            codecall: { appId: 'primary-app' },
            source: 'secondary-app',
          },
          owner: { id: 'tertiary-app' },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['namespace:tool'] });

      expect(result.tools[0].appId).toBe('primary-app');
    });

    it('should use source when codecall.appId is missing', async () => {
      const mockTools = [
        createMockTool({
          name: 'namespace:tool',
          metadata: {
            source: 'source-app',
          },
          owner: { id: 'owner-app' },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['namespace:tool'] });

      expect(result.tools[0].appId).toBe('source-app');
    });
  });

  describe('Example Generation', () => {
    it('should generate basic example for simple tool', async () => {
      const mockTools = [
        createMockTool({
          name: 'users:get',
          rawInputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
            required: ['id'],
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:get'] });

      expect(result.tools[0].usageExample).toBeDefined();
      expect(result.tools[0].usageExample.description).toBeDefined();
      expect(result.tools[0].usageExample.code).toContain('callTool');
      expect(result.tools[0].usageExample.code).toContain('users:get');
    });

    it('should generate pagination example for paginated schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'users:list',
          rawInputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number' },
              offset: { type: 'number' },
              cursor: { type: 'string' },
            },
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:list'] });

      expect(result.tools[0].usageExample).toBeDefined();
      expect(result.tools[0].usageExample.code).toContain('users:list');
    });

    it('should generate filter example for filter schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'users:search',
          rawInputSchema: {
            type: 'object',
            properties: {
              filter: { type: 'object' },
              query: { type: 'string' },
            },
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['users:search'] });

      expect(result.tools[0].usageExample).toBeDefined();
      expect(result.tools[0].usageExample.code).toContain('users:search');
    });

    it('should generate example when no input schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'health:check',
          rawInputSchema: undefined,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['health:check'] });

      expect(result.tools[0].usageExample).toBeDefined();
      expect(result.tools[0].usageExample.code).toContain('health:check');
    });
  });

  describe('Output Structure', () => {
    it('should include all required fields in tool output', async () => {
      const mockTools = [
        createMockTool({
          name: 'test:tool',
          description: 'Test description',
          rawInputSchema: { type: 'object' },
          outputSchema: { type: 'string' },
          metadata: {
            annotations: { audience: ['users'] },
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['test:tool'] });

      const toolInfo = result.tools[0];
      expect(toolInfo).toHaveProperty('name', 'test:tool');
      expect(toolInfo).toHaveProperty('appId');
      expect(toolInfo).toHaveProperty('description', 'Test description');
      expect(toolInfo).toHaveProperty('inputSchema');
      expect(toolInfo).toHaveProperty('outputSchema');
      expect(toolInfo).toHaveProperty('annotations');
      expect(toolInfo).toHaveProperty('usageExample');
    });

    it('should use fallback description when not provided', async () => {
      const mockTools = [
        createMockTool({
          name: 'my:tool',
        }),
      ];
      // Remove the description metadata
      mockTools[0].metadata = { description: '' };

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['my:tool'] });

      expect(result.tools[0].description).toBe('Tool: my:tool');
    });

    it('should include inputSchema as null when not provided', async () => {
      const mockTools = [
        createMockTool({
          name: 'simple:tool',
          rawInputSchema: undefined,
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['simple:tool'] });

      expect(result.tools[0].inputSchema).toBeNull();
    });

    it('should not include notFound when all tools found', async () => {
      const mockTools = [createMockTool({ name: 'a:tool' }), createMockTool({ name: 'b:tool' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['a:tool', 'b:tool'] });

      expect(result.notFound).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty toolNames array', async () => {
      const tool = createDescribeTool([]);
      const result = await tool.execute({ toolNames: [] });

      expect(result.tools).toHaveLength(0);
      expect(result.notFound).toBeUndefined();
    });

    it('should handle tool with empty name', async () => {
      const mockTools = [createMockTool({ name: '' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: [''] });

      // Empty string should be found since it exists
      expect(result.tools).toHaveLength(1);
    });

    it('should handle tool name with multiple colons', async () => {
      const mockTools = [createMockTool({ name: 'app:module:action' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['app:module:action'] });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].appId).toBe('app'); // First part before colon
    });

    it('should handle special characters in tool name', async () => {
      const mockTools = [createMockTool({ name: 'app_v2:get-user_info' })];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['app_v2:get-user_info'] });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('app_v2:get-user_info');
    });

    it('should handle complex input schema', async () => {
      const mockTools = [
        createMockTool({
          name: 'complex:tool',
          rawInputSchema: {
            type: 'object',
            properties: {
              nested: {
                type: 'object',
                properties: {
                  deep: { type: 'string' },
                },
              },
              array: {
                type: 'array',
                items: { type: 'number' },
              },
            },
            required: ['nested'],
          },
        }),
      ];

      const tool = createDescribeTool(mockTools);
      const result = await tool.execute({ toolNames: ['complex:tool'] });

      expect(result.tools[0].inputSchema).toBeDefined();
      expect(result.tools[0].inputSchema?.properties?.nested).toBeDefined();
    });
  });
});
