// file: libs/browser/src/plugins/__tests__/plugin-manager.test.ts
/**
 * Tests for the PluginManager class.
 */

import { PluginManager } from '../plugin-manager';
import type { BrowserPlugin } from '../browser-plugin.types';
import type { BrowserMcpServer, BrowserToolDefinition } from '../../server/browser-server';

// Mock server
const createMockServer = (): BrowserMcpServer =>
  ({
    name: 'test-server',
    version: '1.0.0',
  } as unknown as BrowserMcpServer);

describe('PluginManager', () => {
  describe('constructor', () => {
    it('should create an empty plugin manager', () => {
      const manager = new PluginManager();
      expect(manager.getAll()).toHaveLength(0);
    });

    it('should register initial plugins', () => {
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
      };

      const manager = new PluginManager({ plugins: [plugin] });
      expect(manager.has('test-plugin')).toBe(true);
      expect(manager.getAll()).toHaveLength(1);
    });
  });

  describe('register', () => {
    it('should register a plugin', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        description: 'A test plugin',
      };

      await manager.register(plugin);
      expect(manager.has('test-plugin')).toBe(true);
    });

    it('should throw if plugin is already registered', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = { name: 'test-plugin' };

      await manager.register(plugin);
      await expect(manager.register(plugin)).rejects.toThrow('already registered');
    });

    it('should throw if dependency is not registered', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'dependent-plugin',
        dependencies: ['missing-plugin'],
      };

      await expect(manager.register(plugin)).rejects.toThrow('requires "missing-plugin"');
    });

    it('should call onRegister lifecycle hook', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const onRegister = jest.fn();
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        onRegister,
      };

      await manager.register(plugin);
      expect(onRegister).toHaveBeenCalledTimes(1);
    });
  });

  describe('unregister', () => {
    it('should unregister a plugin', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = { name: 'test-plugin' };
      await manager.register(plugin);
      expect(manager.has('test-plugin')).toBe(true);

      await manager.unregister('test-plugin');
      expect(manager.has('test-plugin')).toBe(false);
    });

    it('should throw if other plugins depend on it', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const basePlugin: BrowserPlugin = { name: 'base-plugin' };
      const dependentPlugin: BrowserPlugin = {
        name: 'dependent-plugin',
        dependencies: ['base-plugin'],
      };

      await manager.register(basePlugin);
      await manager.register(dependentPlugin);

      await expect(manager.unregister('base-plugin')).rejects.toThrow('depends on it');
    });

    it('should call onUnregister lifecycle hook', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const onUnregister = jest.fn();
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        onUnregister,
      };

      await manager.register(plugin);
      await manager.unregister('test-plugin');
      expect(onUnregister).toHaveBeenCalledTimes(1);
    });
  });

  describe('lifecycle', () => {
    it('should call onStart when startAll is called', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const onStart = jest.fn();
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        onStart,
      };

      await manager.register(plugin);
      await manager.startAll();

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should call onStop when stopAll is called', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const onStop = jest.fn();
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        onStop,
      };

      await manager.register(plugin);
      await manager.startAll();
      await manager.stopAll();

      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('collectTools', () => {
    it('should collect tools from all plugins', () => {
      const tool1: BrowserToolDefinition = {
        name: 'tool1',
        description: 'Tool 1',
        inputSchema: { type: 'object' },
        handler: async () => 'result1',
      };

      const tool2: BrowserToolDefinition = {
        name: 'tool2',
        description: 'Tool 2',
        inputSchema: { type: 'object' },
        handler: async () => 'result2',
      };

      const manager = new PluginManager({
        plugins: [
          { name: 'plugin1', tools: [tool1] },
          { name: 'plugin2', tools: [tool2] },
        ],
      });

      const tools = manager.collectTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool2']);
    });
  });

  describe('executeHooks', () => {
    it('should execute willHandle hooks', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const willHandle = jest.fn();
      const plugin: BrowserPlugin = {
        name: 'test-plugin',
        hooks: { willHandle },
      };

      await manager.register(plugin);

      const ctx = await manager.executeHooks('willHandle', 'test/method', { foo: 'bar' });
      expect(willHandle).toHaveBeenCalledTimes(1);
      expect(ctx.method).toBe('test/method');
      expect(ctx.params).toEqual({ foo: 'bar' });
    });

    it('should support short-circuit with respond()', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'cache-plugin',
        hooks: {
          willCallTool: (ctx) => {
            ctx.respond({ cached: true });
          },
        },
      };

      await manager.register(plugin);

      const ctx = await manager.executeHooks('willCallTool', 'tools/call', {
        name: 'test-tool',
      });

      expect(ctx._flowAction.type).toBe('respond');
      expect((ctx._flowAction as { type: 'respond'; result: unknown }).result).toEqual({ cached: true });
    });

    it('should support abort with abort()', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'auth-plugin',
        hooks: {
          willCallTool: (ctx) => {
            ctx.abort(new Error('Unauthorized'));
          },
        },
      };

      await manager.register(plugin);

      const ctx = await manager.executeHooks('willCallTool', 'tools/call', {
        name: 'test-tool',
      });

      expect(ctx._flowAction.type).toBe('abort');
      expect((ctx._flowAction as { type: 'abort'; error: Error }).error.message).toBe('Unauthorized');
    });

    it('should pass metadata between hooks', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'timing-plugin',
        hooks: {
          willCallTool: (ctx) => {
            ctx.metadata.startTime = Date.now();
          },
          didCallTool: (ctx) => {
            const duration = Date.now() - (ctx.metadata.startTime as number);
            ctx.metadata.duration = duration;
          },
        },
      };

      await manager.register(plugin);

      const willCtx = await manager.executeHooks('willCallTool', 'tools/call', {
        name: 'test-tool',
      });
      expect(willCtx.metadata.startTime).toBeDefined();

      // Simulate passing metadata to didCallTool
      const didCtx = await manager.executeHooks('didCallTool', 'tools/call', { name: 'test-tool' }, { content: [] });
      expect(didCtx.metadata).toBeDefined();
    });
  });

  describe('getPlugin', () => {
    it('should return the plugin by name', async () => {
      const manager = new PluginManager();
      manager.setServer(createMockServer());

      const plugin: BrowserPlugin = {
        name: 'my-plugin',
        version: '1.0.0',
      };

      await manager.register(plugin);

      const retrieved = manager.get('my-plugin');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('my-plugin');
      expect(retrieved?.version).toBe('1.0.0');
    });

    it('should return undefined for non-existent plugin', () => {
      const manager = new PluginManager();
      expect(manager.get('non-existent')).toBeUndefined();
    });
  });
});
