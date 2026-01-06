// file: libs/plugins/src/codecall/__tests__/search.tool.test.ts

import SearchTool from '../tools/search.tool';
import type { SearchToolOutput } from '../tools/search.schema';
import { searchToolInputSchema } from '../tools/search.schema';
import { ToolSearchService } from '../services';

// Mock the SDK
jest.mock('@frontmcp/sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tool: (config: any) => (target: any) => target,
  ToolContext: class MockToolContext {
    private services = new Map<unknown, unknown>();
    scope = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    constructor(_args?: any) {
      // Intentionally empty - mock constructor
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(token: any): any {
      return this.services.get(token);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setService(token: any, service: any) {
      this.services.set(token, service);
    }
  },
}));

// Mock the ToolSearchService
const mockSearchService = {
  hasTool: jest.fn(),
  search: jest.fn(),
  getTotalCount: jest.fn(),
};

jest.mock('../services', () => ({
  ToolSearchService: class MockToolSearchService {},
}));

describe('SearchTool', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tool: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool = new (SearchTool as any)();
    tool.setService(ToolSearchService, mockSearchService);

    // Default mock implementations
    mockSearchService.hasTool.mockReturnValue(true);
    mockSearchService.getTotalCount.mockReturnValue(100);
  });

  describe('Multi-Query Search', () => {
    it('should search for multiple queries and merge results', async () => {
      mockSearchService.search
        .mockResolvedValueOnce([
          { toolName: 'users:delete', appId: 'users', description: 'Delete a user', relevanceScore: 0.9 },
        ])
        .mockResolvedValueOnce([
          { toolName: 'users:create', appId: 'users', description: 'Create a user', relevanceScore: 0.85 },
        ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['delete user', 'create user'],
      });

      expect(mockSearchService.search).toHaveBeenCalledTimes(2);
      expect(mockSearchService.search).toHaveBeenNthCalledWith(1, 'delete user', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenNthCalledWith(2, 'create user', expect.any(Object));

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('users:delete');
      expect(result.tools[0].matchedQueries).toEqual(['delete user']);
      expect(result.tools[1].name).toBe('users:create');
      expect(result.tools[1].matchedQueries).toEqual(['create user']);
    });

    it('should deduplicate tools found by multiple queries', async () => {
      mockSearchService.search
        .mockResolvedValueOnce([
          { toolName: 'users:manage', appId: 'users', description: 'Manage users', relevanceScore: 0.8 },
        ])
        .mockResolvedValueOnce([
          { toolName: 'users:manage', appId: 'users', description: 'Manage users', relevanceScore: 0.9 },
        ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['delete user', 'create user'],
      });

      // Should deduplicate - only one tool
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('users:manage');
      // Should contain both queries
      expect(result.tools[0].matchedQueries).toContain('delete user');
      expect(result.tools[0].matchedQueries).toContain('create user');
      // Should keep the highest relevance score
      expect(result.tools[0].relevanceScore).toBe(0.9);
    });

    it('should filter results below minRelevanceScore', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.5 },
        { toolName: 'users:search', appId: 'users', description: 'Search users', relevanceScore: 0.2 }, // Below threshold
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
        minRelevanceScore: 0.3, // default
      });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('users:list');

      // Verify low_relevance warning is emitted
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'low_relevance',
          message: expect.stringContaining('1 result(s) filtered'),
        }),
      );
    });

    it('should use custom minRelevanceScore', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.5 },
        { toolName: 'users:search', appId: 'users', description: 'Search users', relevanceScore: 0.4 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
        minRelevanceScore: 0.45,
      });

      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('users:list');
    });

    it('should sort results by relevance score descending', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.5 },
        { toolName: 'users:search', appId: 'users', description: 'Search users', relevanceScore: 0.9 },
        { toolName: 'users:filter', appId: 'users', description: 'Filter users', relevanceScore: 0.7 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
      });

      expect(result.tools[0].name).toBe('users:search');
      expect(result.tools[1].name).toBe('users:filter');
      expect(result.tools[2].name).toBe('users:list');
    });
  });

  describe('Warnings', () => {
    it('should warn when excluded tools are not found', async () => {
      mockSearchService.hasTool.mockImplementation((name: string) => name !== 'nonexistent:tool');
      mockSearchService.search.mockResolvedValue([]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
        excludeToolNames: ['users:list', 'nonexistent:tool'],
      });

      expect(result.warnings).toHaveLength(2); // excluded_tool_not_found + no_results
      expect(result.warnings[0].type).toBe('excluded_tool_not_found');
      expect(result.warnings[0].affectedTools).toContain('nonexistent:tool');
    });

    it('should warn when no results found', async () => {
      mockSearchService.search.mockResolvedValue([]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['nonexistent functionality'],
      });

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          type: 'no_results',
          message: expect.stringContaining('nonexistent functionality'),
        }),
      );
    });
  });

  describe('Search Options', () => {
    it('should pass topK to search service', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        topK: 10,
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('find users', expect.objectContaining({ topK: 10 }));
    });

    it('should pass appIds to search service', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        appIds: ['users', 'billing'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(
        'find users',
        expect.objectContaining({ appIds: ['users', 'billing'] }),
      );
    });

    it('should pass excludeToolNames to search service', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        excludeToolNames: ['users:list'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(
        'find users',
        expect.objectContaining({ excludeToolNames: ['users:list'] }),
      );
    });
  });

  describe('Output Format', () => {
    it('should return totalAvailableTools from search service', async () => {
      mockSearchService.getTotalCount.mockReturnValue(42);
      mockSearchService.search.mockResolvedValue([]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
      });

      expect(result.totalAvailableTools).toBe(42);
    });

    it('should include optional appId in tool results', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: undefined, description: 'List users', relevanceScore: 0.9 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['list users'],
      });

      expect(result.tools[0].appId).toBeUndefined();
    });
  });

  describe('Input Edge Cases', () => {
    it('should handle single query with minimum length (2 chars)', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'go:run', appId: 'go', description: 'Run Go', relevanceScore: 0.8 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['go'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('go', expect.any(Object));
      expect(result.tools).toHaveLength(1);
    });

    it('should handle query at maximum length (256 chars)', async () => {
      const maxQuery = 'a'.repeat(256);
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: [maxQuery],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(maxQuery, expect.any(Object));
    });

    it('should handle maximum number of queries (10)', async () => {
      const tenQueries = Array.from({ length: 10 }, (_, i) => `query ${i}`);
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: tenQueries,
      });

      expect(mockSearchService.search).toHaveBeenCalledTimes(10);
    });

    it('should handle minRelevanceScore at boundary 0', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.001 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['list'],
        minRelevanceScore: 0,
      });

      // Score 0.001 should pass when minRelevanceScore is 0
      expect(result.tools).toHaveLength(1);
    });

    it('should handle minRelevanceScore at boundary 1', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.99 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['list'],
        minRelevanceScore: 1,
      });

      // Score 0.99 should NOT pass when minRelevanceScore is 1
      expect(result.tools).toHaveLength(0);
    });

    it('should handle topK at boundary 1', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.9 },
      ]);

      await tool.execute({
        queries: ['list'],
        topK: 1,
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('list', expect.objectContaining({ topK: 1 }));
    });

    it('should handle topK at boundary 50', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['list'],
        topK: 50,
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('list', expect.objectContaining({ topK: 50 }));
    });

    it('should handle queries with unicode characters', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.8 },
      ]);

      await tool.execute({
        queries: ['ユーザー検索', 'búsqueda de usuario', '🔍 find'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('ユーザー検索', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenCalledWith('búsqueda de usuario', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenCalledWith('🔍 find', expect.any(Object));
    });

    it('should handle queries with special characters', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['list-users', 'get_user', 'user.find'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('list-users', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenCalledWith('get_user', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenCalledWith('user.find', expect.any(Object));
    });

    it('should handle queries with newlines and tabs', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find\nusers', 'get\tusers'],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('find\nusers', expect.any(Object));
      expect(mockSearchService.search).toHaveBeenCalledWith('get\tusers', expect.any(Object));
    });

    it('should handle empty excludeToolNames array', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        excludeToolNames: [],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(
        'find users',
        expect.objectContaining({ excludeToolNames: [] }),
      );
    });

    it('should handle empty appIds array', async () => {
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        appIds: [],
      });

      expect(mockSearchService.search).toHaveBeenCalledWith('find users', expect.objectContaining({ appIds: [] }));
    });

    it('should handle maximum excludeToolNames (50)', async () => {
      const fiftyToolNames = Array.from({ length: 50 }, (_, i) => `tool:name${i}`);
      mockSearchService.search.mockResolvedValue([]);
      mockSearchService.hasTool.mockReturnValue(true);

      await tool.execute({
        queries: ['find users'],
        excludeToolNames: fiftyToolNames,
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(
        'find users',
        expect.objectContaining({ excludeToolNames: fiftyToolNames }),
      );
    });

    it('should handle maximum appIds (10)', async () => {
      const tenAppIds = Array.from({ length: 10 }, (_, i) => `app${i}`);
      mockSearchService.search.mockResolvedValue([]);

      await tool.execute({
        queries: ['find users'],
        appIds: tenAppIds,
      });

      expect(mockSearchService.search).toHaveBeenCalledWith(
        'find users',
        expect.objectContaining({ appIds: tenAppIds }),
      );
    });
  });

  describe('Result Edge Cases', () => {
    it('should handle all queries returning same tools', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.9 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['list users', 'get users', 'find users'],
      });

      // Should deduplicate - only one tool
      expect(result.tools).toHaveLength(1);
      // Should have all matched queries
      expect(result.tools[0].matchedQueries).toContain('list users');
      expect(result.tools[0].matchedQueries).toContain('get users');
      expect(result.tools[0].matchedQueries).toContain('find users');
    });

    it('should handle very high number of results', async () => {
      const manyTools = Array.from({ length: 100 }, (_, i) => ({
        toolName: `tool:name${i}`,
        appId: `app${i % 10}`,
        description: `Tool ${i}`,
        relevanceScore: 0.9 - i * 0.001,
      }));
      mockSearchService.search.mockResolvedValue(manyTools);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find tools'],
      });

      // All tools above minRelevanceScore should be returned
      expect(result.tools.length).toBeGreaterThan(0);
      // Should be sorted by relevance
      for (let i = 1; i < result.tools.length; i++) {
        expect(result.tools[i - 1].relevanceScore).toBeGreaterThanOrEqual(result.tools[i].relevanceScore);
      }
    });

    it('should handle search service returning empty description', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: '', relevanceScore: 0.9 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['list users'],
      });

      expect(result.tools[0].description).toBe('');
    });

    it('should handle identical relevance scores', async () => {
      mockSearchService.search.mockResolvedValue([
        { toolName: 'users:list', appId: 'users', description: 'List users', relevanceScore: 0.9 },
        { toolName: 'users:get', appId: 'users', description: 'Get users', relevanceScore: 0.9 },
        { toolName: 'users:find', appId: 'users', description: 'Find users', relevanceScore: 0.9 },
      ]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['users'],
      });

      expect(result.tools).toHaveLength(3);
      // All should have same score
      expect(result.tools[0].relevanceScore).toBe(0.9);
      expect(result.tools[1].relevanceScore).toBe(0.9);
      expect(result.tools[2].relevanceScore).toBe(0.9);
    });
  });

  describe('Error Handling', () => {
    it('should handle search service throwing error', async () => {
      mockSearchService.search.mockRejectedValue(new Error('Search service unavailable'));

      await expect(
        tool.execute({
          queries: ['find users'],
        }),
      ).rejects.toThrow('Search service unavailable');
    });

    it('should handle getTotalCount returning 0', async () => {
      mockSearchService.getTotalCount.mockReturnValue(0);
      mockSearchService.search.mockResolvedValue([]);

      const result: SearchToolOutput = await tool.execute({
        queries: ['find users'],
      });

      expect(result.totalAvailableTools).toBe(0);
    });
  });

  describe('Input Schema Validation', () => {
    // Note: The SDK's Tool decorator handles input validation at runtime.
    // These tests validate the schema directly since the mock bypasses the decorator.

    it('should reject query string below minimum length', () => {
      const result = searchToolInputSchema.safeParse({
        queries: ['a'], // min length is 2
      });
      expect(result.success).toBe(false);
    });

    it('should reject query string exceeding maximum length', () => {
      const tooLongQuery = 'a'.repeat(257); // max length is 256
      const result = searchToolInputSchema.safeParse({
        queries: [tooLongQuery],
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty queries array', () => {
      const result = searchToolInputSchema.safeParse({
        queries: [], // min array length is 1
      });
      expect(result.success).toBe(false);
    });

    it('should reject queries array exceeding maximum length', () => {
      const elevenQueries = Array.from({ length: 11 }, (_, i) => `query ${i}`); // max is 10
      const result = searchToolInputSchema.safeParse({
        queries: elevenQueries,
      });
      expect(result.success).toBe(false);
    });

    it('should reject minRelevanceScore below valid range', () => {
      const result = searchToolInputSchema.safeParse({
        queries: ['find users'],
        minRelevanceScore: -0.1, // min is 0
      });
      expect(result.success).toBe(false);
    });

    it('should reject minRelevanceScore above valid range', () => {
      const result = searchToolInputSchema.safeParse({
        queries: ['find users'],
        minRelevanceScore: 1.5, // max is 1
      });
      expect(result.success).toBe(false);
    });

    it('should accept valid input', () => {
      const result = searchToolInputSchema.safeParse({
        queries: ['find users', 'list orders'],
        minRelevanceScore: 0.5,
        topK: 10,
      });
      expect(result.success).toBe(true);
    });
  });
});
