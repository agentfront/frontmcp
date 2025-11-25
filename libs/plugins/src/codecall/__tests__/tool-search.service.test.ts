import { ToolSearchService } from '../services/tool-search.service';
import { ToolEntry, ScopeEntry } from '@frontmcp/sdk';

// Mock ScopeEntry with tools
const createMockScope = (tools: ToolEntry<any, any>[]): ScopeEntry => {
  return {
    tools: {
      getTools: jest.fn().mockReturnValue(tools),
    },
  } as any;
};

describe('ToolSearchService', () => {
  describe('TF-IDF strategy (default)', () => {
    let service: ToolSearchService;
    let mockScope: ScopeEntry;

    beforeEach(() => {
      mockScope = createMockScope([]);
      service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
    });

    describe('initialization', () => {
      it('should initialize with an empty index', () => {
        expect(service.getTotalCount()).toBe(0);
      });

      it('should index tools on initialize', async () => {
        const mockTools: ToolEntry<any, any>[] = [
          {
            name: 'users:getById',
            fullName: 'users:getById',
            metadata: {
              name: 'users:getById',
              description: 'Get a user by ID',
              tags: ['user', 'read'],
            },
            owner: { kind: 'app', id: 'users' },
          } as any,
          {
            name: 'users:list',
            fullName: 'users:list',
            metadata: {
              name: 'users:list',
              description: 'List all users',
              tags: ['user', 'list'],
            },
            owner: { kind: 'app', id: 'users' },
          } as any,
        ];

        mockScope = createMockScope(mockTools);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();

        expect(service.getTotalCount()).toBe(2);
        expect(service.hasTool('users:getById')).toBe(true);
        expect(service.hasTool('users:list')).toBe(true);
      });

      it('should not re-initialize if already initialized', async () => {
        const mockTools1: ToolEntry<any, any>[] = [
          {
            name: 'tool1',
            fullName: 'tool1',
            metadata: { name: 'tool1', description: 'First tool' },
          } as any,
        ];

        mockScope = createMockScope(mockTools1);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();
        expect(service.getTotalCount()).toBe(1);

        // Change scope tools, but initialize should do nothing
        (mockScope.tools.getTools as jest.Mock).mockReturnValue([
          {
            name: 'tool2',
            fullName: 'tool2',
            metadata: { name: 'tool2', description: 'Second tool' },
          } as any,
        ]);

        await service.initialize(); // Should be ignored
        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('tool1')).toBe(true);
        expect(service.hasTool('tool2')).toBe(false);
      });
    });

    describe('search', () => {
      beforeEach(async () => {
        const mockTools: ToolEntry<any, any>[] = [
          {
            name: 'users:getById',
            fullName: 'users:getById',
            metadata: {
              name: 'users:getById',
              description: 'Get a user by their unique identifier',
              tags: ['user', 'read', 'authentication'],
            },
            owner: { kind: 'app', id: 'users' },
          } as any,
          {
            name: 'users:list',
            fullName: 'users:list',
            metadata: {
              name: 'users:list',
              description: 'List all users in the system',
              tags: ['user', 'list'],
            },
            owner: { kind: 'app', id: 'users' },
          } as any,
          {
            name: 'billing:getInvoice',
            fullName: 'billing:getInvoice',
            metadata: {
              name: 'billing:getInvoice',
              description: 'Retrieve invoice details',
              tags: ['billing', 'invoice'],
            },
            owner: { kind: 'app', id: 'billing' },
          } as any,
        ];

        mockScope = createMockScope(mockTools);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();
      });

      it('should search for tools by query', async () => {
        const results = await service.search('user authentication');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].toolName).toBe('users:getById');
      });

      it('should filter by appIds', async () => {
        const results = await service.search('invoice', {
          appIds: ['billing'],
        });

        expect(results.length).toBe(1);
        expect(results[0].toolName).toBe('billing:getInvoice');
      });

      it('should exclude tools by name', async () => {
        const results = await service.search('user', {
          excludeToolNames: ['users:getById'],
        });

        expect(results.every((r) => r.toolName !== 'users:getById')).toBe(true);
      });

      it('should limit results with topK', async () => {
        const results = await service.search('user', {
          topK: 1,
        });

        expect(results.length).toBe(1);
      });

      it('should return results with correct structure', async () => {
        const results = await service.search('user');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]).toHaveProperty('toolName');
        expect(results[0]).toHaveProperty('description');
        expect(results[0]).toHaveProperty('relevanceScore');
        expect(results[0]).toHaveProperty('appId');
      });
    });

    describe('clear', () => {
      it('should clear all indexed tools', async () => {
        const mockTools: ToolEntry<any, any>[] = [
          {
            name: 'tool1',
            fullName: 'tool1',
            metadata: { name: 'tool1', description: 'Test tool' },
          } as any,
        ];

        mockScope = createMockScope(mockTools);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();
        expect(service.getTotalCount()).toBe(1);

        service.clear();
        expect(service.getTotalCount()).toBe(0);
      });

      it('should allow re-initialization after clear', async () => {
        const mockTools1: ToolEntry<any, any>[] = [
          {
            name: 'tool1',
            fullName: 'tool1',
            metadata: { name: 'tool1', description: 'First tool' },
          } as any,
        ];

        mockScope = createMockScope(mockTools1);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();
        service.clear();

        // Update scope to return different tools
        (mockScope.tools.getTools as jest.Mock).mockReturnValue([
          {
            name: 'tool2',
            fullName: 'tool2',
            metadata: { name: 'tool2', description: 'Second tool' },
          } as any,
        ]);

        await service.initialize();

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('tool2')).toBe(true);
      });
    });

    describe('utility methods', () => {
      beforeEach(async () => {
        const mockTools: ToolEntry<any, any>[] = [
          {
            name: 'tool1',
            fullName: 'tool1',
            metadata: { name: 'tool1', description: 'First tool' },
          } as any,
          {
            name: 'tool2',
            fullName: 'tool2',
            metadata: { name: 'tool2', description: 'Second tool' },
          } as any,
        ];

        mockScope = createMockScope(mockTools);
        service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
        await service.initialize();
      });

      it('should get all tool names', () => {
        const names = service.getAllToolNames();

        expect(names).toContain('tool1');
        expect(names).toContain('tool2');
        expect(names.length).toBe(2);
      });

      it('should check if a tool exists', () => {
        expect(service.hasTool('tool1')).toBe(true);
        expect(service.hasTool('nonexistent')).toBe(false);
      });

      it('should get total count', () => {
        expect(service.getTotalCount()).toBe(2);
      });

      it('should return the strategy', () => {
        expect(service.getStrategy()).toBe('tfidf');
      });
    });
  });

  describe('Strategy configuration', () => {
    it('should create service with TF-IDF strategy', () => {
      const mockScope = createMockScope([]);
      const service = new ToolSearchService({ strategy: 'tfidf' }, mockScope);
      expect(service.getStrategy()).toBe('tfidf');
    });

    it('should create service with ML strategy', () => {
      const mockScope = createMockScope([]);
      const service = new ToolSearchService({ strategy: 'ml' }, mockScope);
      expect(service.getStrategy()).toBe('ml');
    });

    it('should default to TF-IDF strategy', () => {
      const mockScope = createMockScope([]);
      const service = new ToolSearchService({}, mockScope);
      expect(service.getStrategy()).toBe('tfidf');
    });

    it('should accept embedding options', () => {
      const mockScope = createMockScope([]);
      const service = new ToolSearchService(
        {
          embeddingOptions: {
            strategy: 'tfidf',
          },
        },
        mockScope,
      );
      expect(service.getStrategy()).toBe('tfidf');
    });
  });
});
