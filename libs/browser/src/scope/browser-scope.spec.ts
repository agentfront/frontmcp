// file: libs/browser/src/scope/browser-scope.spec.ts
/**
 * Tests for BrowserScope
 */

import { BrowserScope, createBrowserScope } from './browser-scope';
import type { ScopeToolDefinition, ScopeResourceDefinition, ScopePromptDefinition } from './types';

describe('BrowserScope', () => {
  let scope: BrowserScope;

  beforeEach(() => {
    scope = createBrowserScope({
      serverInfo: { name: 'test-app', version: '1.0.0' },
    });
  });

  afterEach(async () => {
    if (scope.isStarted) {
      await scope.stop();
    }
  });

  describe('constructor', () => {
    it('should create a scope with server info', () => {
      expect(scope.serverInfo.name).toBe('test-app');
      expect(scope.serverInfo.version).toBe('1.0.0');
    });

    it('should generate a unique ID', () => {
      expect(scope.id).toBeDefined();
      expect(scope.id).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('should initialize with empty registries', () => {
      const stats = scope.getStats();
      expect(stats.tools).toBe(0);
      expect(stats.resources).toBe(0);
      expect(stats.prompts).toBe(0);
    });

    it('should not be started initially', () => {
      expect(scope.isStarted).toBe(false);
    });
  });

  describe('createBrowserScope', () => {
    it('should be a factory function', () => {
      const newScope = createBrowserScope({
        serverInfo: { name: 'factory-test', version: '2.0.0' },
      });
      expect(newScope).toBeInstanceOf(BrowserScope);
      expect(newScope.serverInfo.name).toBe('factory-test');
    });
  });

  describe('tool registration', () => {
    const testTool: ScopeToolDefinition = {
      name: 'test-tool',
      description: 'A test tool',
      handler: (input) => (input as { value: number }).value * 2,
    };

    it('should register a tool', () => {
      scope.registerTool(testTool);
      expect(scope.hasTool('test-tool')).toBe(true);
    });

    it('should throw when registering duplicate tool', () => {
      scope.registerTool(testTool);
      expect(() => scope.registerTool(testTool)).toThrow('already registered');
    });

    it('should get a registered tool', () => {
      scope.registerTool(testTool);
      const tool = scope.getTool('test-tool');
      expect(tool?.name).toBe('test-tool');
    });

    it('should return undefined for non-existent tool', () => {
      expect(scope.getTool('non-existent')).toBeUndefined();
    });

    it('should list all tools', () => {
      scope.registerTool(testTool);
      scope.registerTool({ ...testTool, name: 'another-tool' });
      const tools = scope.listTools();
      expect(tools).toHaveLength(2);
    });

    it('should unregister a tool', () => {
      scope.registerTool(testTool);
      const removed = scope.unregisterTool('test-tool');
      expect(removed).toBe(true);
      expect(scope.hasTool('test-tool')).toBe(false);
    });

    it('should return false when unregistering non-existent tool', () => {
      const removed = scope.unregisterTool('non-existent');
      expect(removed).toBe(false);
    });

    it('should execute a tool', async () => {
      scope.registerTool(testTool);
      const result = await scope.executeTool('test-tool', { value: 5 });
      expect(result).toBe(10);
    });

    it('should throw when executing non-existent tool', async () => {
      await expect(scope.executeTool('non-existent', {})).rejects.toThrow('not found');
    });

    it('should emit tool change events', () => {
      const events: { kind: string; toolName: string }[] = [];
      scope.onToolChange((event) => events.push(event));

      scope.registerTool(testTool);
      scope.unregisterTool('test-tool');

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ kind: 'added', toolName: 'test-tool' });
      expect(events[1]).toEqual({ kind: 'removed', toolName: 'test-tool' });
    });

    it('should unsubscribe from tool change events', () => {
      const events: unknown[] = [];
      const unsubscribe = scope.onToolChange((event) => events.push(event));

      scope.registerTool(testTool);
      unsubscribe();
      scope.registerTool({ ...testTool, name: 'another' });

      expect(events).toHaveLength(1);
    });
  });

  describe('resource registration', () => {
    const testResource: ScopeResourceDefinition = {
      uri: 'test://resource',
      name: 'Test Resource',
      description: 'A test resource',
      handler: () => ({ data: 'test' }),
    };

    it('should register a resource', () => {
      scope.registerResource(testResource);
      expect(scope.hasResource('test://resource')).toBe(true);
    });

    it('should throw when registering duplicate resource', () => {
      scope.registerResource(testResource);
      expect(() => scope.registerResource(testResource)).toThrow('already registered');
    });

    it('should get a registered resource', () => {
      scope.registerResource(testResource);
      const resource = scope.getResource('test://resource');
      expect(resource?.name).toBe('Test Resource');
    });

    it('should list all resources', () => {
      scope.registerResource(testResource);
      scope.registerResource({ ...testResource, uri: 'test://other' });
      const resources = scope.listResources();
      expect(resources).toHaveLength(2);
    });

    it('should unregister a resource', () => {
      scope.registerResource(testResource);
      const removed = scope.unregisterResource('test://resource');
      expect(removed).toBe(true);
      expect(scope.hasResource('test://resource')).toBe(false);
    });

    it('should read a resource', async () => {
      scope.registerResource(testResource);
      const data = await scope.readResource('test://resource');
      expect(data).toEqual({ data: 'test' });
    });

    it('should throw when reading non-existent resource', async () => {
      await expect(scope.readResource('non-existent')).rejects.toThrow('not found');
    });

    it('should emit resource change events', () => {
      const events: { kind: string; resourceUri: string }[] = [];
      scope.onResourceChange((event) => events.push(event));

      scope.registerResource(testResource);
      scope.unregisterResource('test://resource');

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ kind: 'added', resourceUri: 'test://resource' });
      expect(events[1]).toEqual({ kind: 'removed', resourceUri: 'test://resource' });
    });
  });

  describe('prompt registration', () => {
    const testPrompt: ScopePromptDefinition = {
      name: 'test-prompt',
      description: 'A test prompt',
      handler: (args) => `Hello, ${args['name']}!`,
    };

    it('should register a prompt', () => {
      scope.registerPrompt(testPrompt);
      expect(scope.hasPrompt('test-prompt')).toBe(true);
    });

    it('should throw when registering duplicate prompt', () => {
      scope.registerPrompt(testPrompt);
      expect(() => scope.registerPrompt(testPrompt)).toThrow('already registered');
    });

    it('should get a registered prompt', () => {
      scope.registerPrompt(testPrompt);
      const prompt = scope.getPrompt('test-prompt');
      expect(prompt?.name).toBe('test-prompt');
    });

    it('should list all prompts', () => {
      scope.registerPrompt(testPrompt);
      scope.registerPrompt({ ...testPrompt, name: 'another-prompt' });
      const prompts = scope.listPrompts();
      expect(prompts).toHaveLength(2);
    });

    it('should unregister a prompt', () => {
      scope.registerPrompt(testPrompt);
      const removed = scope.unregisterPrompt('test-prompt');
      expect(removed).toBe(true);
      expect(scope.hasPrompt('test-prompt')).toBe(false);
    });

    it('should execute a prompt', async () => {
      scope.registerPrompt(testPrompt);
      const result = await scope.executePrompt('test-prompt', { name: 'World' });
      expect(result).toBe('Hello, World!');
    });

    it('should throw when executing non-existent prompt', async () => {
      await expect(scope.executePrompt('non-existent', {})).rejects.toThrow('not found');
    });
  });

  describe('lifecycle', () => {
    it('should start the scope', async () => {
      await scope.start();
      expect(scope.isStarted).toBe(true);
    });

    it('should not start twice', async () => {
      await scope.start();
      await scope.start(); // Should not throw
      expect(scope.isStarted).toBe(true);
    });

    it('should stop the scope', async () => {
      await scope.start();
      await scope.stop();
      expect(scope.isStarted).toBe(false);
    });

    it('should not stop when not started', async () => {
      await scope.stop(); // Should not throw
      expect(scope.isStarted).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('should return capabilities with no registrations', () => {
      const caps = scope.getCapabilities();
      expect(caps.tools.listChanged).toBe(false);
      expect(caps.resources.listChanged).toBe(false);
      expect(caps.prompts.listChanged).toBe(false);
    });

    it('should return capabilities with registrations', () => {
      scope.registerTool({
        name: 'tool',
        description: 'test',
        handler: () => {},
      });

      const caps = scope.getCapabilities();
      expect(caps.tools.listChanged).toBe(true);
    });
  });

  describe('utility methods', () => {
    it('should clear all registrations', () => {
      scope.registerTool({
        name: 'tool',
        description: 'test',
        handler: () => {},
      });
      scope.registerResource({
        uri: 'test://r',
        name: 'r',
        handler: () => {},
      });

      scope.clear();

      expect(scope.getStats()).toEqual({ tools: 0, resources: 0, prompts: 0 });
    });

    it('should get stats', () => {
      scope.registerTool({
        name: 'tool',
        description: 'test',
        handler: () => {},
      });

      const stats = scope.getStats();
      expect(stats.tools).toBe(1);
      expect(stats.resources).toBe(0);
      expect(stats.prompts).toBe(0);
    });
  });
});
