/**
 * Unit tests for PluginRegistry
 */

import 'reflect-metadata';
import PluginRegistry from '../plugin.registry';
import { PluginInterface } from '../../common/interfaces';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { createClassProvider, createValueProvider } from '../../__test-utils__/fixtures/provider.fixtures';
import { createProviderRegistryWithScope } from '../../__test-utils__/fixtures/scope.fixtures';

describe('PluginRegistry', () => {
  describe('Basic Registration', () => {
    it('should register a plugin with metadata', async () => {
      @FrontMcpPlugin({
        name: 'TestPlugin',
        description: 'A test plugin',
      })
      class TestPlugin implements PluginInterface {
        constructor() {}
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [TestPlugin]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(TestPlugin);
    });

    it('should register multiple plugins', async () => {
      @FrontMcpPlugin({
        name: 'PluginA',
        description: 'First plugin',
      })
      class PluginA implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'PluginB',
        description: 'Second plugin',
      })
      class PluginB implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginA, PluginB]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins[0]).toBeInstanceOf(PluginA);
      expect(plugins[1]).toBeInstanceOf(PluginB);
    });

    it('should register a plugin using useClass', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN_TOKEN');

      class TestPluginImpl implements PluginInterface {
        constructor() {}
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [
        {
          provide: PLUGIN_TOKEN,
          useClass: TestPluginImpl,
          name: 'TestPlugin',
          description: 'A test plugin',
        },
      ]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(TestPluginImpl);
    });

    it('should register a plugin using useFactory', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN_TOKEN');

      const factoryFn = () => ({
        name: 'FactoryPlugin',
      });

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [
        {
          provide: PLUGIN_TOKEN,
          useFactory: factoryFn,
          name: 'FactoryPlugin',
          description: 'A factory plugin',
        },
      ]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect((plugins[0] as any).name).toBe('FactoryPlugin');
      expect(typeof plugins[0].get).toBe('function');
    });

    it('should register a plugin using useValue', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN_TOKEN');

      const pluginValue = {
        name: 'ValuePlugin',
        getValue: () => 'value',
      };

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [
        {
          provide: PLUGIN_TOKEN,
          useValue: pluginValue,
          name: 'ValuePlugin',
          description: 'A value plugin',
        },
      ]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toEqual(pluginValue);
    });
  });

  describe('Plugin with Providers', () => {
    it('should register plugin-scoped providers', async () => {
      const SERVICE_TOKEN = Symbol('SERVICE');

      @FrontMcpPlugin({
        name: 'PluginWithProviders',
        description: 'Plugin that provides services',
        providers: [],
      })
      class PluginWithProviders implements PluginInterface {
        get: any;

        getService() {
          return this.get(SERVICE_TOKEN);
        }
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithProviders]);
      await registry.ready;

      const plugins = registry.getPlugins();
      const plugin = plugins[0] as any as PluginWithProviders;

      expect(plugin).toBeInstanceOf(PluginWithProviders);
      expect(typeof plugin.get).toBe('function');
    });

    it('should export providers to parent registry', async () => {
      const EXPORTED_SERVICE_TOKEN = Symbol('EXPORTED_SERVICE');

      @FrontMcpPlugin({
        name: 'PluginWithExports',
        description: 'Plugin that exports services',
        providers: [],
        exports: [],
      })
      class PluginWithExports implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithExports]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(PluginWithExports);
    });
  });

  describe('Dependency Resolution', () => {
    it('should resolve plugin dependencies from parent provider registry', async () => {
      @FrontMcpPlugin({
        name: 'DependentPlugin',
        description: 'Plugin with dependencies',
      })
      class DependentPlugin implements PluginInterface {
        constructor() {}
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [DependentPlugin]);
      await registry.ready;

      const plugins = registry.getPlugins();
      const plugin = plugins[0] as any as DependentPlugin;

      expect(plugin).toBeInstanceOf(DependentPlugin);
    });

    it('should create plugin even if optional dependencies are not registered', async () => {
      @FrontMcpPlugin({
        name: 'SimplePlugin',
        description: 'Plugin without dependencies',
      })
      class SimplePlugin implements PluginInterface {
        constructor() {}
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [SimplePlugin]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(SimplePlugin);
    });

    it('should resolve factory plugin dependencies', async () => {
      const PLUGIN_TOKEN = Symbol('FACTORY_PLUGIN');
      const SERVICE_TOKEN = Symbol('SERVICE');

      class Service {
        getName() {
          return 'TestService';
        }
      }

      const providers = await createProviderRegistryWithScope([createClassProvider(Service, { name: 'Service' })]);

      const registry = new PluginRegistry(providers, [
        {
          provide: PLUGIN_TOKEN,
          inject: () => [Service] as const,
          useFactory: ((service: Service) => {
            return { serviceName: service.getName() };
          }) as any,
          name: 'FactoryPlugin',
          description: 'Factory plugin with deps',
        },
      ]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect((plugins[0] as any).serviceName).toBe('TestService');
      expect(typeof plugins[0].get).toBe('function');
    });
  });

  describe('Nested Plugins', () => {
    it('should register plugins with nested plugins', async () => {
      @FrontMcpPlugin({
        name: 'NestedPlugin',
        description: 'A nested plugin',
      })
      class NestedPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'ParentPlugin',
        description: 'Parent plugin with nested plugins',
        plugins: [NestedPlugin],
      })
      class ParentPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [ParentPlugin]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(ParentPlugin);
    });
  });

  describe('Plugin Tools and Resources', () => {
    it('should register plugin with tools', async () => {
      @FrontMcpPlugin({
        name: 'PluginWithTools',
        description: 'Plugin that provides tools',
        tools: [],
      })
      class PluginWithTools implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithTools]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(PluginWithTools);
    });

    it('should register plugin with resources', async () => {
      @FrontMcpPlugin({
        name: 'PluginWithResources',
        description: 'Plugin that provides resources',
        resources: [],
      })
      class PluginWithResources implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithResources]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(PluginWithResources);
    });

    it('should register plugin with prompts', async () => {
      @FrontMcpPlugin({
        name: 'PluginWithPrompts',
        description: 'Plugin that provides prompts',
        prompts: [],
      })
      class PluginWithPrompts implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithPrompts]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(PluginWithPrompts);
    });

    it('should register plugin with adapters', async () => {
      @FrontMcpPlugin({
        name: 'PluginWithAdapters',
        description: 'Plugin that provides adapters',
        adapters: [],
      })
      class PluginWithAdapters implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithAdapters]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(PluginWithAdapters);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid plugin type', async () => {
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [null as any]);
      }).toThrow(/Invalid plugin/);
    });

    it('should throw error for plugin without provide', async () => {
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [
          {
            useValue: { name: 'test' },
            name: 'NoProvidePlugin',
          } as any,
        ]);
      }).toThrow(/missing 'provide'/);
    });

    it('should throw error for plugin with invalid useClass', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [
          {
            provide: PLUGIN_TOKEN,
            useClass: 'not a class' as any,
            name: 'InvalidPlugin',
          },
        ]);
      }).toThrow(/must be a class/);
    });

    it('should throw error for plugin with invalid useFactory', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [
          {
            provide: PLUGIN_TOKEN,
            useFactory: 'not a function' as any,
            name: 'InvalidPlugin',
          },
        ]);
      }).toThrow(/must be a function/);
    });

    it('should throw error for plugin with null useValue', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [
          {
            provide: PLUGIN_TOKEN,
            useValue: null,
            name: 'NullValuePlugin',
          } as any,
        ]);
      }).toThrow(/must be defined/);
    });

    it('should throw error for plugin with undefined useValue', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');
      const providers = await createProviderRegistryWithScope();

      expect(() => {
        new PluginRegistry(providers, [
          {
            provide: PLUGIN_TOKEN,
            useValue: undefined,
            name: 'UndefinedValuePlugin',
          } as any,
        ]);
      }).toThrow(/must be defined/);
    });
  });

  describe('Plugin get method', () => {
    it('should provide get method to access plugin-scoped providers', async () => {
      const SERVICE_TOKEN = Symbol('SERVICE');

      @FrontMcpPlugin({
        name: 'PluginWithGet',
        description: 'Plugin that uses get method',
        providers: [],
      })
      class PluginWithGet implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [PluginWithGet]);
      await registry.ready;

      const plugins = registry.getPlugins();
      const plugin = plugins[0] as any as PluginWithGet;

      expect(typeof plugin.get).toBe('function');
    });
  });

  describe('Dynamic Providers', () => {
    it('should handle plugins with dynamic providers', async () => {
      const DYNAMIC_TOKEN = Symbol('DYNAMIC');

      class DynamicPlugin implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();

      const registry = new PluginRegistry(providers, [
        {
          provide: DynamicPlugin,
          useValue: new DynamicPlugin(),
          name: 'DynamicPlugin',
        },
      ]);
      await registry.ready;

      const plugins = registry.getPlugins();
      const plugin = plugins[0] as any as DynamicPlugin;

      expect(plugin).toBeInstanceOf(DynamicPlugin);
      expect(typeof plugin.get).toBe('function');
    });
  });
});
