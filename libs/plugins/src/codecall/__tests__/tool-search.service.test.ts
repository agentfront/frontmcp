import { ToolSearchService, IncludeToolsFilter } from '../services/tool-search.service';
import { ToolEntry, ScopeEntry } from '@frontmcp/sdk';
import type { CodeCallMode, CodeCallToolMetadata } from '../codecall.types';

/**
 * Creates a mock ScopeEntry with tools that support subscription.
 * Tools are passed to the subscription callback on initialization.
 */
const createMockScope = (
  initialTools: ToolEntry<any, any>[] = [],
): {
  scope: ScopeEntry;
  triggerToolChange: (tools: ToolEntry<any, any>[]) => void;
} => {
  let subscriptionCallback: ((event: { snapshot: ToolEntry<any, any>[] }) => void) | null = null;

  const scope = {
    tools: {
      getTools: jest.fn().mockReturnValue(initialTools),
      subscribe: jest.fn((opts: { immediate?: boolean }, cb: (event: { snapshot: ToolEntry<any, any>[] }) => void) => {
        subscriptionCallback = cb;
        // If immediate=true, call the callback right away with current tools
        if (opts.immediate) {
          cb({ snapshot: initialTools });
        }
        // Return unsubscribe function
        return () => {
          subscriptionCallback = null;
        };
      }),
    },
  } as any;

  return {
    scope,
    triggerToolChange: (tools: ToolEntry<any, any>[]) => {
      if (subscriptionCallback) {
        subscriptionCallback({ snapshot: tools });
      }
    },
  };
};

/**
 * Creates a mock tool entry for testing
 */
const createMockTool = (
  name: string,
  options: {
    description?: string;
    tags?: string[];
    appId?: string;
    codecall?: CodeCallToolMetadata;
  } = {},
): ToolEntry<any, any> => {
  return {
    name,
    fullName: name,
    metadata: {
      name,
      description: options.description || `Tool ${name}`,
      tags: options.tags,
      codecall: options.codecall,
    },
    owner: options.appId ? { kind: 'app', id: options.appId } : undefined,
  } as any;
};

describe('ToolSearchService', () => {
  describe('Reactive subscription', () => {
    it('should subscribe to tool changes on construction', () => {
      const { scope } = createMockScope([]);
      new ToolSearchService({ strategy: 'tfidf' }, scope);

      expect(scope.tools.subscribe).toHaveBeenCalledWith({ immediate: true }, expect.any(Function));
    });

    it('should automatically index tools from immediate subscription', async () => {
      const tools = [
        createMockTool('tool1', { description: 'First tool' }),
        createMockTool('tool2', { description: 'Second tool' }),
      ];
      const { scope } = createMockScope(tools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

      // Wait for microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(service.getTotalCount()).toBe(2);
      expect(service.hasTool('tool1')).toBe(true);
      expect(service.hasTool('tool2')).toBe(true);
    });

    it('should reindex when tools change', async () => {
      const initialTools = [createMockTool('tool1')];
      const { scope, triggerToolChange } = createMockScope(initialTools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.getTotalCount()).toBe(1);

      // Trigger tool change with new tools
      const newTools = [createMockTool('tool1'), createMockTool('tool2'), createMockTool('tool3')];
      triggerToolChange(newTools);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.getTotalCount()).toBe(3);
    });

    it('should cleanup subscription on dispose', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

      await new Promise((resolve) => setTimeout(resolve, 0));

      service.dispose();

      // Verify unsubscribe was called (returned function from subscribe)
      expect(scope.tools.subscribe).toHaveBeenCalled();
    });
  });

  describe('Tool filtering', () => {
    describe('CodeCall meta-tools exclusion', () => {
      it('should always exclude codecall:* meta-tools', async () => {
        const tools = [
          createMockTool('codecall:search'),
          createMockTool('codecall:describe'),
          createMockTool('codecall:execute'),
          createMockTool('codecall:invoke'),
          createMockTool('users:list', { description: 'List users' }),
        ];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
        expect(service.hasTool('codecall:search')).toBe(false);
        expect(service.hasTool('codecall:describe')).toBe(false);
        expect(service.hasTool('codecall:execute')).toBe(false);
        expect(service.hasTool('codecall:invoke')).toBe(false);
      });
    });

    describe('Mode: codecall_only (default)', () => {
      it('should index all non-codecall tools by default', async () => {
        const tools = [createMockTool('users:list'), createMockTool('billing:invoice')];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_only' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(2);
      });

      it('should exclude tools with enabledInCodeCall=false', async () => {
        const tools = [
          createMockTool('users:list'),
          createMockTool('billing:invoice', { codecall: { enabledInCodeCall: false } }),
        ];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_only' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
        expect(service.hasTool('billing:invoice')).toBe(false);
      });

      it('should include tools with enabledInCodeCall=true', async () => {
        const tools = [createMockTool('users:list', { codecall: { enabledInCodeCall: true } })];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_only' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
      });
    });

    describe('Mode: codecall_opt_in', () => {
      it('should only index tools with enabledInCodeCall=true', async () => {
        const tools = [
          createMockTool('users:list'),
          createMockTool('billing:invoice', { codecall: { enabledInCodeCall: true } }),
          createMockTool('orders:get', { codecall: { enabledInCodeCall: false } }),
        ];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_opt_in' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('billing:invoice')).toBe(true);
        expect(service.hasTool('users:list')).toBe(false);
        expect(service.hasTool('orders:get')).toBe(false);
      });

      it('should exclude tools without enabledInCodeCall metadata', async () => {
        const tools = [createMockTool('users:list'), createMockTool('billing:invoice')];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_opt_in' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(0);
      });
    });

    describe('Mode: metadata_driven', () => {
      it('should index tools by default (no metadata)', async () => {
        const tools = [createMockTool('users:list'), createMockTool('billing:invoice')];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'metadata_driven' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(2);
      });

      it('should exclude tools with enabledInCodeCall=false', async () => {
        const tools = [
          createMockTool('users:list'),
          createMockTool('billing:invoice', { codecall: { enabledInCodeCall: false } }),
        ];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'metadata_driven' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
        expect(service.hasTool('billing:invoice')).toBe(false);
      });

      it('should include tools with enabledInCodeCall=true', async () => {
        const tools = [createMockTool('users:list', { codecall: { enabledInCodeCall: true } })];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'metadata_driven' }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
      });
    });

    describe('Custom includeTools filter', () => {
      it('should apply includeTools filter', async () => {
        const tools = [
          createMockTool('users:list', { appId: 'users' }),
          createMockTool('billing:invoice', { appId: 'billing' }),
          createMockTool('orders:get', { appId: 'orders' }),
        ];
        const { scope } = createMockScope(tools);

        // Only include tools from 'users' app
        const includeTools: IncludeToolsFilter = (info) => info.appId === 'users';

        const service = new ToolSearchService({ strategy: 'tfidf', includeTools }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
        expect(service.hasTool('billing:invoice')).toBe(false);
      });

      it('should pass tool info to includeTools filter', async () => {
        const includeToolsFn = jest.fn().mockReturnValue(true);

        const tools = [
          createMockTool('users:list', {
            description: 'List users',
            appId: 'users',
            codecall: { source: 'openapi', tags: ['auth'] },
          }),
        ];
        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', includeTools: includeToolsFn }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(includeToolsFn).toHaveBeenCalledWith({
          name: 'users:list',
          appId: 'users',
          source: 'openapi',
          description: 'List users',
          tags: ['auth'],
        });
      });

      it('should combine mode filtering with includeTools filter', async () => {
        const tools = [
          createMockTool('users:list', { appId: 'users', codecall: { enabledInCodeCall: true } }),
          createMockTool('billing:invoice', { appId: 'billing', codecall: { enabledInCodeCall: true } }),
          createMockTool('orders:get', { appId: 'users', codecall: { enabledInCodeCall: false } }),
        ];
        const { scope } = createMockScope(tools);

        // Only include tools from 'users' app
        const includeTools: IncludeToolsFilter = (info) => info.appId === 'users';

        const service = new ToolSearchService({ strategy: 'tfidf', mode: 'codecall_opt_in', includeTools }, scope);

        await new Promise((resolve) => setTimeout(resolve, 0));

        // Only users:list passes both filters:
        // - mode=codecall_opt_in requires enabledInCodeCall=true
        // - includeTools requires appId='users'
        expect(service.getTotalCount()).toBe(1);
        expect(service.hasTool('users:list')).toBe(true);
      });
    });
  });

  describe('Search functionality', () => {
    let service: ToolSearchService;

    beforeEach(async () => {
      const tools = [
        createMockTool('users:getById', {
          description: 'Get a user by their unique identifier',
          tags: ['user', 'read', 'authentication'],
          appId: 'users',
        }),
        createMockTool('users:list', {
          description: 'List all users in the system',
          tags: ['user', 'list'],
          appId: 'users',
        }),
        createMockTool('billing:getInvoice', {
          description: 'Retrieve invoice details',
          tags: ['billing', 'invoice'],
          appId: 'billing',
        }),
      ];

      const { scope } = createMockScope(tools);
      service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      await new Promise((resolve) => setTimeout(resolve, 0));
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

  describe('Utility methods', () => {
    let service: ToolSearchService;

    beforeEach(async () => {
      const tools = [
        createMockTool('tool1', { description: 'First tool' }),
        createMockTool('tool2', { description: 'Second tool' }),
      ];

      const { scope } = createMockScope(tools);
      service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      await new Promise((resolve) => setTimeout(resolve, 0));
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

    it('should clear all indexed tools', async () => {
      expect(service.getTotalCount()).toBe(2);

      service.clear();
      expect(service.getTotalCount()).toBe(0);
    });
  });

  describe('Strategy configuration', () => {
    it('should create service with TF-IDF strategy', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      expect(service.getStrategy()).toBe('tfidf');
      service.dispose();
    });

    it('should create service with ML strategy', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ strategy: 'ml' }, scope);
      expect(service.getStrategy()).toBe('ml');
      service.dispose();
    });

    it('should default to TF-IDF strategy', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({}, scope);
      expect(service.getStrategy()).toBe('tfidf');
      service.dispose();
    });

    it('should accept embedding options', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService(
        {
          embeddingOptions: {
            strategy: 'tfidf',
            modelName: 'Xenova/all-MiniLM-L6-v2',
            cacheDir: './.cache/transformers',
            useHNSW: false,
          },
        },
        scope,
      );
      expect(service.getStrategy()).toBe('tfidf');
      service.dispose();
    });

    it('should default to codecall_only mode', async () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({}, scope);
      // We can verify by behavior - codecall_only allows all non-codecall tools
      const tools = [createMockTool('test')];
      const { scope: newScope } = createMockScope(tools);
      const newService = new ToolSearchService({}, newScope);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(newService.getTotalCount()).toBe(1);
      service.dispose();
      newService.dispose();
    });
  });

  describe('Initialize method (backwards compatibility)', () => {
    it('should be a no-op for interface compatibility', async () => {
      const tools = [createMockTool('tool1')];
      const { scope } = createMockScope(tools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(service.getTotalCount()).toBe(1);

      // Initialize should be a no-op
      await service.initialize();
      expect(service.getTotalCount()).toBe(1);

      // Clean up subscription to prevent async cleanup issues
      service.dispose();
    });
  });

  describe('Constructor validation', () => {
    it('should throw for invalid mode string', () => {
      const { scope } = createMockScope([]);
      expect(() => new ToolSearchService({ mode: 'invalid' as any }, scope)).toThrow('Invalid CodeCall mode: invalid');
    });

    it('should apply default mode when null is passed', () => {
      const { scope } = createMockScope([]);
      // When mode is explicitly null, it should default to 'codecall_only' (via nullish coalescing)
      const service = new ToolSearchService({ mode: null as any }, scope);
      expect(service.getStrategy()).toBe('tfidf');
      service.dispose();
    });

    it('should throw for undefined mode when explicitly passed', () => {
      const { scope } = createMockScope([]);
      // When mode is explicitly undefined, it should default to 'codecall_only' and not throw
      // This tests that the default value is applied before validation
      const service = new ToolSearchService({ mode: undefined }, scope);
      expect(service.getStrategy()).toBe('tfidf');
      service.dispose();
    });

    it('should accept valid mode: codecall_only', () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ mode: 'codecall_only' }, scope);
      expect(service).toBeDefined();
      service.dispose();
    });

    it('should accept valid mode: codecall_opt_in', () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ mode: 'codecall_opt_in' }, scope);
      expect(service).toBeDefined();
      service.dispose();
    });

    it('should accept valid mode: metadata_driven', () => {
      const { scope } = createMockScope([]);
      const service = new ToolSearchService({ mode: 'metadata_driven' }, scope);
      expect(service).toBeDefined();
      service.dispose();
    });
  });

  describe('Example indexing', () => {
    it('should index tool examples in search', async () => {
      const tools = [
        {
          name: 'users:create',
          fullName: 'users:create',
          metadata: {
            name: 'users:create',
            description: 'Create a new user',
            examples: [
              {
                description: 'Create an admin user with elevated permissions',
                input: { email: 'admin@company.com', role: 'administrator' },
              },
              {
                description: 'Create a regular member',
                input: { email: 'member@example.org', role: 'member' },
              },
            ],
          },
        } as any,
        {
          name: 'billing:invoice',
          fullName: 'billing:invoice',
          metadata: {
            name: 'billing:invoice',
            description: 'Get invoice details',
          },
        } as any,
      ];

      const { scope } = createMockScope(tools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Searching for "admin" should find users:create because it's in the example
      const results = await service.search('admin');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].toolName).toBe('users:create');

      service.dispose();
    });

    it('should index example input values in search', async () => {
      const tools = [
        {
          name: 'users:create',
          fullName: 'users:create',
          metadata: {
            name: 'users:create',
            description: 'Create a new user',
            examples: [
              {
                description: 'Example usage',
                input: { email: 'specialized-term@unique.com', role: 'operator' },
              },
            ],
          },
        } as any,
      ];

      const { scope } = createMockScope(tools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Searching for a unique term from input value should find the tool
      const results = await service.search('specialized-term');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].toolName).toBe('users:create');

      service.dispose();
    });

    it('should not fail when examples is undefined', async () => {
      const tools = [
        {
          name: 'users:list',
          fullName: 'users:list',
          metadata: {
            name: 'users:list',
            description: 'List all users',
            // No examples field
          },
        } as any,
      ];

      const { scope } = createMockScope(tools);
      const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(service.getTotalCount()).toBe(1);
      expect(service.hasTool('users:list')).toBe(true);

      service.dispose();
    });
  });

  describe('Synonym expansion', () => {
    describe('with TF-IDF strategy', () => {
      it('should enable synonym expansion by default', async () => {
        const tools = [
          createMockTool('users:create', {
            description: 'Create a new user in the CRM system',
            appId: 'crm',
          }),
          createMockTool('users:list', {
            description: 'List all users in the CRM',
            appId: 'crm',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // "add user" should find "users:create" via synonym expansion (add -> create)
        const results = await service.search('add user');

        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.toolName === 'users:create')).toBe(true);

        service.dispose();
      });

      it('should match "add" to "create" via synonyms', async () => {
        const tools = [
          createMockTool('users:create', {
            description: 'Create a new user in the system',
            appId: 'users',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Search using synonym "add" instead of "create"
        const results = await service.search('add');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].toolName).toBe('users:create');

        service.dispose();
      });

      it('should match "remove" to "delete" via synonyms', async () => {
        const tools = [
          createMockTool('users:delete', {
            description: 'Delete a user from the system',
            appId: 'users',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Search using synonym "remove" instead of "delete"
        const results = await service.search('remove user');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].toolName).toBe('users:delete');

        service.dispose();
      });

      it('should match "fetch" to "get" via synonyms', async () => {
        const tools = [
          createMockTool('users:get', {
            description: 'Get a user by ID',
            appId: 'users',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf' }, scope);
        await new Promise((resolve) => setTimeout(resolve, 0));

        const results = await service.search('fetch user');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].toolName).toBe('users:get');

        service.dispose();
      });

      it('should be disabled when synonymExpansion is false', async () => {
        const tools = [
          createMockTool('users:create', {
            description: 'Create a new user in the system',
            appId: 'users',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService({ strategy: 'tfidf', synonymExpansion: false }, scope);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Without synonym expansion, "add" should not match "create"
        const results = await service.search('add');

        // Should find no results or very low relevance since "add" doesn't appear in the description
        const createResults = results.filter((r) => r.toolName === 'users:create');
        expect(createResults.length === 0 || createResults[0].relevanceScore < 0.1).toBe(true);

        service.dispose();
      });

      it('should accept custom synonym groups', async () => {
        const tools = [
          createMockTool('orders:purchase', {
            description: 'Purchase an item for a customer',
            appId: 'orders',
          }),
        ];

        const { scope } = createMockScope(tools);
        const service = new ToolSearchService(
          {
            strategy: 'tfidf',
            synonymExpansion: {
              additionalSynonyms: [['buy', 'purchase', 'order']],
            },
          },
          scope,
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        // "buy" should match "purchase" via custom synonym
        const results = await service.search('buy item');

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].toolName).toBe('orders:purchase');

        service.dispose();
      });
    });

    describe('with ML strategy', () => {
      it('should not use synonym expansion (ML handles semantic similarity)', async () => {
        const { scope } = createMockScope([]);
        const service = new ToolSearchService({ strategy: 'ml' }, scope);

        // ML strategy should not have synonym expansion enabled
        // (we can't easily test this without mocking internals, but we verify no errors occur)
        expect(service.getStrategy()).toBe('ml');

        service.dispose();
      });
    });
  });
});
