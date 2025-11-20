/// <reference types="jest" />
/**
 * Test fixtures for plugins
 */

import { PluginMetadata } from '../../common/metadata';
import { PluginInterface } from '../../common/interfaces';
import { createProviderMetadata } from './provider.fixtures';
import { createToolMetadata } from './tool.fixtures';

/**
 * Creates a simple plugin metadata object
 */
export function createPluginMetadata(overrides: Partial<PluginMetadata> = {}): PluginMetadata {
  return {
    name: 'TestPlugin',
    description: 'A test plugin',
    ...overrides,
  };
}

/**
 * Creates a plugin with providers
 */
export function createPluginWithProviders(): PluginMetadata {
  return {
    name: 'PluginWithProviders',
    description: 'A plugin with providers',
    providers: [
      {
        provide: Symbol('SERVICE_A'),
        useValue: { name: 'Service A' },
        ...createProviderMetadata({ name: 'ServiceA' }),
      },
    ],
  };
}

/**
 * Creates a plugin with tools
 */
export function createPluginWithTools(): PluginMetadata {
  return {
    name: 'PluginWithTools',
    description: 'A plugin with tools',
    tools: [],
  };
}

/**
 * Creates a plugin with nested plugins
 */
export function createPluginWithNestedPlugins(): PluginMetadata {
  return {
    name: 'ParentPlugin',
    description: 'A plugin with nested plugins',
    plugins: [],
  };
}

/**
 * Mock plugin class for testing
 */
export class MockPluginClass implements PluginInterface {
  static readonly metadata: PluginMetadata = {
    name: 'MockPlugin',
    description: 'A mock plugin',
  };

  constructor() {}

  async onInit?(): Promise<void> {
    // Mock initialization
  }

  async onDestroy?(): Promise<void> {
    // Mock cleanup
  }
}

/**
 * Creates a mock plugin instance
 */
export function createMockPluginInstance(metadata?: Partial<PluginMetadata>) {
  return {
    metadata: createPluginMetadata(metadata),
    onInit: jest.fn(async () => {}),
    onDestroy: jest.fn(async () => {}),
  };
}

/**
 * Creates multiple plugins for dependency testing
 */
export function createPluginDependencyChain() {
  const pluginA: PluginMetadata = {
    name: 'PluginA',
    description: 'First plugin in chain',
    providers: [
      {
        provide: Symbol('SERVICE_A'),
        useValue: { name: 'Service A' },
        ...createProviderMetadata({ name: 'ServiceA' }),
      },
    ],
  };

  const pluginB: PluginMetadata = {
    name: 'PluginB',
    description: 'Second plugin in chain (depends on A)',
    providers: [
      {
        provide: Symbol('SERVICE_B'),
        useValue: { name: 'Service B' },
        ...createProviderMetadata({ name: 'ServiceB' }),
      },
    ],
  };

  const pluginC: PluginMetadata = {
    name: 'PluginC',
    description: 'Third plugin in chain (depends on B)',
    providers: [
      {
        provide: Symbol('SERVICE_C'),
        useValue: { name: 'Service C' },
        ...createProviderMetadata({ name: 'ServiceC' }),
      },
    ],
  };

  return { pluginA, pluginB, pluginC };
}
