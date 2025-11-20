/// <reference types="jest" />
/**
 * Mock factory for PluginRegistry
 */

import { PluginMetadata } from '../../common/metadata';

/**
 * Creates a mock PluginRegistry for testing
 */
export function createMockPluginRegistry(overrides: Partial<any> = {}) {
  const plugins = new Map<string, any>();

  return {
    plugins,

    register: jest.fn((pluginName: string, plugin: any) => {
      plugins.set(pluginName, plugin);
      return plugin;
    }),

    get: jest.fn((pluginName: string) => {
      return plugins.get(pluginName);
    }),

    has: jest.fn((pluginName: string) => {
      return plugins.has(pluginName);
    }),

    getAll: jest.fn(() => {
      return Array.from(plugins.values());
    }),

    getNames: jest.fn(() => {
      return Array.from(plugins.keys());
    }),

    clear: jest.fn(() => {
      plugins.clear();
    }),

    // Nested registries access
    getProviderRegistry: jest.fn(() => null),
    getToolRegistry: jest.fn(() => null),
    getHookRegistry: jest.fn(() => null),

    ...overrides,
  };
}

/**
 * Creates a mock plugin entry
 */
export function createMockPluginEntry(name: string, metadata?: Partial<PluginMetadata>) {
  return {
    name,
    metadata: {
      name,
      description: `Mock plugin: ${name}`,
      ...metadata,
    },
    onInit: jest.fn(async () => {}),
    onDestroy: jest.fn(async () => {}),
  };
}

/**
 * Adds a plugin to a mock registry
 */
export function addPluginToMock(registry: ReturnType<typeof createMockPluginRegistry>, name: string, pluginEntry: any) {
  registry.plugins.set(name, pluginEntry);
  registry.has.mockImplementation((n: string) => n === name || registry.plugins.has(n));
  registry.get.mockImplementation((n: string) => {
    if (n === name) return pluginEntry;
    return registry.plugins.get(n);
  });
}
