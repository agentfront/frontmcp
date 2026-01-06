// file: plugins/plugin-dashboard/src/__tests__/graph-data.provider.test.ts

import 'reflect-metadata';
import { GraphDataProvider } from '../providers/graph-data.provider';

// Mock types for ScopeEntry
interface MockToolRecord {
  name: string;
  fullName: string;
  metadata?: { description?: string; tags?: string[] };
  inputSchema?: unknown;
  outputSchema?: unknown;
}

interface MockResourceRecord {
  name: string;
  uri: string;
  metadata?: { description?: string; mimeType?: string };
}

interface MockResourceTemplateRecord {
  name: string;
  uriTemplate: string;
  metadata?: { description?: string; mimeType?: string };
}

interface MockPromptRecord {
  name: string;
  metadata?: { description?: string; arguments?: unknown[] };
}

interface MockAppRecord {
  metadata?: { name?: string; description?: string };
}

interface MockScopeEntry {
  id: string;
  tools?: {
    getTools?: (includePlugins?: boolean) => MockToolRecord[];
  };
  resources?: {
    getResources?: (includePlugins?: boolean) => MockResourceRecord[];
    getResourceTemplates?: () => MockResourceTemplateRecord[];
  };
  prompts?: {
    getPrompts?: (includePlugins?: boolean) => MockPromptRecord[];
  };
  apps?: {
    getApps?: () => MockAppRecord[];
  };
  providers: {
    getRegistries: (name: string) => { getScopes: () => MockScopeEntry[] }[];
  };
}

describe('GraphDataProvider', () => {
  function createMockScope(options: Partial<MockScopeEntry> = {}): MockScopeEntry {
    return {
      id: options.id || 'test-scope',
      tools: options.tools,
      resources: options.resources,
      prompts: options.prompts,
      apps: options.apps,
      providers: options.providers || {
        getRegistries: () => [],
      },
    };
  }

  describe('constructor', () => {
    it('should create provider with server name', () => {
      const scope = createMockScope();
      const provider = new GraphDataProvider(scope as never, 'MyServer');

      expect(provider).toBeInstanceOf(GraphDataProvider);
    });

    it('should create provider with server name and version', () => {
      const scope = createMockScope();
      const provider = new GraphDataProvider(scope as never, 'MyServer', '1.0.0');

      expect(provider).toBeInstanceOf(GraphDataProvider);
    });
  });

  describe('getGraphData', () => {
    it('should return graph data with server node', async () => {
      const scope = createMockScope();
      const provider = new GraphDataProvider(scope as never, 'TestServer', '1.0.0');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'server:TestServer',
          type: 'server',
          label: 'TestServer',
        }),
      );
    });

    it('should return graph metadata', async () => {
      const scope = createMockScope();
      const provider = new GraphDataProvider(scope as never, 'TestServer', '2.0.0');

      const data = await provider.getGraphData();

      expect(data.metadata.serverName).toBe('TestServer');
      expect(data.metadata.serverVersion).toBe('2.0.0');
      expect(data.metadata.entryFile).toBe('runtime');
      expect(data.metadata.generatedAt).toBeDefined();
      expect(data.metadata.nodeCount).toBeGreaterThanOrEqual(1);
      expect(data.metadata.edgeCount).toBeGreaterThanOrEqual(0);
    });

    it('should include scope node', async () => {
      const scope = createMockScope({ id: 'main' });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'scope:main',
          type: 'scope',
          label: 'main',
        }),
      );
    });

    it('should create edge from server to scope', async () => {
      const scope = createMockScope({ id: 'main' });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'server:TestServer',
          target: 'scope:main',
          type: 'contains',
        }),
      );
    });
  });

  describe('tools extraction', () => {
    it('should extract tools from scope', async () => {
      const scope = createMockScope({
        tools: {
          getTools: () => [{ name: 'my-tool', fullName: 'my-tool', metadata: { description: 'A test tool' } }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'tool:my-tool',
          type: 'tool',
          label: 'my-tool',
          data: expect.objectContaining({
            name: 'my-tool',
            description: 'A test tool',
          }),
        }),
      );
    });

    it('should skip dashboard tools', async () => {
      const scope = createMockScope({
        tools: {
          getTools: () => [
            { name: 'graph', fullName: 'dashboard:graph', metadata: {} },
            { name: 'list-tools', fullName: 'dashboard:list-tools', metadata: {} },
            { name: 'my-tool', fullName: 'my-tool', metadata: {} },
          ],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      const toolNodes = data.nodes.filter((n) => n.type === 'tool');
      expect(toolNodes).toHaveLength(1);
      expect(toolNodes[0].id).toBe('tool:my-tool');
    });

    it('should include tool schemas and tags', async () => {
      const scope = createMockScope({
        tools: {
          getTools: () => [
            {
              name: 'advanced-tool',
              fullName: 'advanced-tool',
              metadata: { description: 'Advanced', tags: ['tag1', 'tag2'] },
              inputSchema: { type: 'object' },
              outputSchema: { type: 'string' },
            },
          ],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      const toolNode = data.nodes.find((n) => n.id === 'tool:advanced-tool');
      expect(toolNode?.data.inputSchema).toEqual({ type: 'object' });
      expect(toolNode?.data.outputSchema).toEqual({ type: 'string' });
      expect(toolNode?.data.tags).toEqual(['tag1', 'tag2']);
    });

    it('should create edge from scope to tool', async () => {
      const scope = createMockScope({
        id: 'main',
        tools: {
          getTools: () => [{ name: 'tool1', fullName: 'tool1' }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'scope:main',
          target: 'tool:tool1',
          type: 'provides',
        }),
      );
    });

    it('should handle missing tools registry gracefully', async () => {
      const scope = createMockScope({ tools: undefined });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      const toolNodes = data.nodes.filter((n) => n.type === 'tool');
      expect(toolNodes).toHaveLength(0);
    });
  });

  describe('resources extraction', () => {
    it('should extract resources from scope', async () => {
      const scope = createMockScope({
        resources: {
          getResources: () => [
            { name: 'config', uri: 'file:///config.json', metadata: { mimeType: 'application/json' } },
          ],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'resource:file:///config.json',
          type: 'resource',
          label: 'config',
          data: expect.objectContaining({
            uri: 'file:///config.json',
            mimeType: 'application/json',
          }),
        }),
      );
    });

    it('should create edge from scope to resource', async () => {
      const scope = createMockScope({
        id: 'main',
        resources: {
          getResources: () => [{ name: 'data', uri: 'file:///data.txt' }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'scope:main',
          target: 'resource:file:///data.txt',
          type: 'provides',
        }),
      );
    });
  });

  describe('resource templates extraction', () => {
    it('should extract resource templates from scope', async () => {
      const scope = createMockScope({
        resources: {
          getResourceTemplates: () => [
            { name: 'user-data', uriTemplate: 'user://{userId}/data', metadata: { description: 'User data' } },
          ],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'resource-template:user://{userId}/data',
          type: 'resource-template',
          label: 'user-data',
        }),
      );
    });

    it('should create edge from scope to resource template', async () => {
      const scope = createMockScope({
        id: 'main',
        resources: {
          getResourceTemplates: () => [{ name: 'template', uriTemplate: 'tmpl://{id}' }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'scope:main',
          target: 'resource-template:tmpl://{id}',
          type: 'provides',
        }),
      );
    });
  });

  describe('prompts extraction', () => {
    it('should extract prompts from scope', async () => {
      const scope = createMockScope({
        prompts: {
          getPrompts: () => [
            { name: 'greeting', metadata: { description: 'Greeting prompt', arguments: [{ name: 'name' }] } },
          ],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'prompt:greeting',
          type: 'prompt',
          label: 'greeting',
          data: expect.objectContaining({
            description: 'Greeting prompt',
          }),
        }),
      );
    });

    it('should create edge from scope to prompt', async () => {
      const scope = createMockScope({
        id: 'main',
        prompts: {
          getPrompts: () => [{ name: 'test-prompt' }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'scope:main',
          target: 'prompt:test-prompt',
          type: 'provides',
        }),
      );
    });
  });

  describe('apps extraction', () => {
    it('should extract apps from scope', async () => {
      const scope = createMockScope({
        apps: {
          getApps: () => [{ metadata: { name: 'my-app', description: 'My application' } }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes).toContainEqual(
        expect.objectContaining({
          id: 'app:my-app',
          type: 'app',
          label: 'my-app',
        }),
      );
    });

    it('should skip dashboard app', async () => {
      const scope = createMockScope({
        apps: {
          getApps: () => [{ metadata: { name: 'dashboard' } }, { metadata: { name: 'my-app' } }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      const appNodes = data.nodes.filter((n) => n.type === 'app');
      expect(appNodes).toHaveLength(1);
      expect(appNodes[0].id).toBe('app:my-app');
    });

    it('should create edge from scope to app', async () => {
      const scope = createMockScope({
        id: 'main',
        apps: {
          getApps: () => [{ metadata: { name: 'app1' } }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.edges).toContainEqual(
        expect.objectContaining({
          source: 'scope:main',
          target: 'app:app1',
          type: 'contains',
        }),
      );
    });

    it('should handle app without metadata name', async () => {
      const scope = createMockScope({
        apps: {
          getApps: () => [{ metadata: {} }],
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      const appNodes = data.nodes.filter((n) => n.type === 'app');
      expect(appNodes).toHaveLength(1);
      expect(appNodes[0].label).toBe('unknown');
    });
  });

  describe('caching', () => {
    it('should return cached data on subsequent calls', async () => {
      const getToolsMock = jest.fn().mockReturnValue([{ name: 'tool1', fullName: 'tool1' }]);
      const scope = createMockScope({
        tools: { getTools: getToolsMock },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      await provider.getGraphData();
      await provider.getGraphData();
      await provider.getGraphData();

      // getTools should only be called once due to caching
      expect(getToolsMock).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL expires', async () => {
      const getToolsMock = jest.fn().mockReturnValue([{ name: 'tool1', fullName: 'tool1' }]);
      const scope = createMockScope({
        tools: { getTools: getToolsMock },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      await provider.getGraphData();

      // Manually invalidate by waiting for TTL (we'll use invalidateCache instead for testing)
      provider.invalidateCache();
      await provider.getGraphData();

      expect(getToolsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateCache', () => {
    it('should clear cached data', async () => {
      const getToolsMock = jest.fn().mockReturnValue([]);
      const scope = createMockScope({
        tools: { getTools: getToolsMock },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      await provider.getGraphData();
      expect(getToolsMock).toHaveBeenCalledTimes(1);

      provider.invalidateCache();
      await provider.getGraphData();

      expect(getToolsMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('multiple scopes', () => {
    it('should use ScopeRegistry when available', async () => {
      const scope1 = createMockScope({
        id: 'scope1',
        tools: { getTools: () => [{ name: 't1', fullName: 't1' }] },
      });
      const scope2 = createMockScope({
        id: 'scope2',
        tools: { getTools: () => [{ name: 't2', fullName: 't2' }] },
      });

      const mainScope = createMockScope({
        id: 'main',
        providers: {
          getRegistries: (name: string) => {
            if (name === 'ScopeRegistry') {
              return [{ getScopes: () => [scope1, scope2] }];
            }
            return [];
          },
        },
      });

      const provider = new GraphDataProvider(mainScope as never, 'TestServer');
      const data = await provider.getGraphData();

      expect(data.nodes.filter((n) => n.type === 'scope')).toHaveLength(2);
      expect(data.nodes.filter((n) => n.type === 'tool')).toHaveLength(2);
    });

    it('should filter out dashboard scope', async () => {
      const dashboardScope = createMockScope({ id: 'dashboard' });
      const mainScope = createMockScope({
        id: 'main',
        providers: {
          getRegistries: (name: string) => {
            if (name === 'ScopeRegistry') {
              return [{ getScopes: () => [dashboardScope, createMockScope({ id: 'app' })] }];
            }
            return [];
          },
        },
      });

      const provider = new GraphDataProvider(mainScope as never, 'TestServer');
      const data = await provider.getGraphData();

      const scopeNodes = data.nodes.filter((n) => n.type === 'scope');
      expect(scopeNodes).toHaveLength(1);
      expect(scopeNodes[0].id).toBe('scope:app');
    });

    it('should fallback to current scope when registry not available', async () => {
      const scope = createMockScope({
        id: 'fallback',
        providers: {
          getRegistries: () => [],
        },
      });

      const provider = new GraphDataProvider(scope as never, 'TestServer');
      const data = await provider.getGraphData();

      const scopeNodes = data.nodes.filter((n) => n.type === 'scope');
      expect(scopeNodes).toHaveLength(1);
      expect(scopeNodes[0].id).toBe('scope:fallback');
    });
  });

  describe('error handling', () => {
    it('should handle tools registry throwing error', async () => {
      const scope = createMockScope({
        tools: {
          getTools: () => {
            throw new Error('Registry error');
          },
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      // Should still return valid data, just without tools
      expect(data.nodes.filter((n) => n.type === 'tool')).toHaveLength(0);
    });

    it('should handle resources registry throwing error', async () => {
      const scope = createMockScope({
        resources: {
          getResources: () => {
            throw new Error('Registry error');
          },
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes.filter((n) => n.type === 'resource')).toHaveLength(0);
    });

    it('should handle prompts registry throwing error', async () => {
      const scope = createMockScope({
        prompts: {
          getPrompts: () => {
            throw new Error('Registry error');
          },
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes.filter((n) => n.type === 'prompt')).toHaveLength(0);
    });

    it('should handle apps registry throwing error', async () => {
      const scope = createMockScope({
        apps: {
          getApps: () => {
            throw new Error('Registry error');
          },
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      expect(data.nodes.filter((n) => n.type === 'app')).toHaveLength(0);
    });

    it('should handle ScopeRegistry getScopes throwing error', async () => {
      const scope = createMockScope({
        providers: {
          getRegistries: (name: string) => {
            if (name === 'ScopeRegistry') {
              return [
                {
                  getScopes: () => {
                    throw new Error('Registry error');
                  },
                },
              ];
            }
            return [];
          },
        },
      });
      const provider = new GraphDataProvider(scope as never, 'TestServer');

      const data = await provider.getGraphData();

      // Should fallback to current scope
      expect(data.nodes.filter((n) => n.type === 'scope')).toHaveLength(1);
    });
  });

  describe('node deduplication', () => {
    it('should not add duplicate nodes', async () => {
      // Simulate a scenario where the same tool appears in multiple scopes
      const sharedTool = { name: 'shared', fullName: 'shared' };
      const scope1 = createMockScope({
        id: 'scope1',
        tools: { getTools: () => [sharedTool] },
      });
      const scope2 = createMockScope({
        id: 'scope2',
        tools: { getTools: () => [sharedTool] },
      });

      const mainScope = createMockScope({
        providers: {
          getRegistries: (name: string) => {
            if (name === 'ScopeRegistry') {
              return [{ getScopes: () => [scope1, scope2] }];
            }
            return [];
          },
        },
      });

      const provider = new GraphDataProvider(mainScope as never, 'TestServer');
      const data = await provider.getGraphData();

      const toolNodes = data.nodes.filter((n) => n.id === 'tool:shared');
      expect(toolNodes).toHaveLength(1);
    });
  });
});
