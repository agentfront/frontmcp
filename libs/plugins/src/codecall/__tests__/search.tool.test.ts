// file: libs/plugins/src/codecall/__tests__/search.tool.test.ts

import SearchTool from '../tools/search.tool';
import type { SearchToolOutput } from '../tools/search.schema';

// Mock the SDK
jest.mock('@frontmcp/sdk', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tool: (config: any) => (target: any) => target,
  ToolContext: class MockToolContext {
    private services = new Map<unknown, unknown>();
    scope = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    constructor(_args?: any) {}
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
    tool.setService(require('../services').ToolSearchService, mockSearchService);

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
});
