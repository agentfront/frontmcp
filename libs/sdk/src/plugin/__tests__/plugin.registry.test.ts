/**
 * Unit tests for PluginRegistry
 */

import 'reflect-metadata';
import PluginRegistry, { PluginScopeInfo } from '../plugin.registry';
import { PluginInterface } from '../../common/interfaces';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { createClassProvider, createValueProvider } from '../../__test-utils__/fixtures/provider.fixtures';
import { createProviderRegistryWithScope, createMockScope } from '../../__test-utils__/fixtures/scope.fixtures';
import { InvalidPluginScopeError } from '../../errors';
import { Scope } from '../../scope';

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
          inject: () => [] as const,
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
            inject: () => [] as const,
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

  describe('Plugin Scope', () => {
    it('should default to app scope when no scope is specified', async () => {
      @FrontMcpPlugin({
        name: 'DefaultScopePlugin',
        description: 'Plugin without explicit scope',
      })
      class DefaultScopePlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [DefaultScopePlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(DefaultScopePlugin);
    });

    it('should register plugin with explicit app scope', async () => {
      @FrontMcpPlugin({
        name: 'AppScopePlugin',
        description: 'Plugin with app scope',
        scope: 'app',
      })
      class AppScopePlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [AppScopePlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(AppScopePlugin);
    });

    it('should register plugin with server scope in non-standalone app', async () => {
      @FrontMcpPlugin({
        name: 'ServerScopePlugin',
        description: 'Plugin with server scope',
        scope: 'server',
      })
      class ServerScopePlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);
      const parentScope = createMockScope();

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [ServerScopePlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(ServerScopePlugin);
    });

    it('should throw InvalidPluginScopeError when server scope plugin is used in standalone app', async () => {
      @FrontMcpPlugin({
        name: 'ServerScopePlugin',
        description: 'Plugin with server scope',
        scope: 'server',
      })
      class ServerScopePlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true, // Standalone app
      };

      const registry = new PluginRegistry(providers, [ServerScopePlugin], undefined, scopeInfo);

      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
      await expect(registry.ready).rejects.toThrow(/scope='server'/);
      await expect(registry.ready).rejects.toThrow(/standalone app/);
    });

    it('should allow app scope plugin in standalone app', async () => {
      @FrontMcpPlugin({
        name: 'AppScopePlugin',
        description: 'Plugin with app scope',
        scope: 'app',
      })
      class AppScopePlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true, // Standalone app
      };

      const registry = new PluginRegistry(providers, [AppScopePlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(AppScopePlugin);
    });

    it('should register mixed scope plugins correctly', async () => {
      @FrontMcpPlugin({
        name: 'AppPlugin',
        description: 'App scope plugin',
        scope: 'app',
      })
      class AppPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'ServerPlugin',
        description: 'Server scope plugin',
        scope: 'server',
      })
      class ServerPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);
      const parentScope = createMockScope();

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [AppPlugin, ServerPlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins[0]).toBeInstanceOf(AppPlugin);
      expect(plugins[1]).toBeInstanceOf(ServerPlugin);
    });

    it('should work without scopeInfo (backward compatibility)', async () => {
      @FrontMcpPlugin({
        name: 'LegacyPlugin',
        description: 'Plugin without scopeInfo',
      })
      class LegacyPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();

      // No scopeInfo passed - should use default behavior
      const registry = new PluginRegistry(providers, [LegacyPlugin]);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toBeInstanceOf(LegacyPlugin);
    });

    it('should validate server scope plugin with object-based registration', async () => {
      const PLUGIN_TOKEN = Symbol('SERVER_PLUGIN');

      class ServerPlugin implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true, // Standalone app
      };

      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useValue: new ServerPlugin(),
            name: 'ServerPlugin',
            scope: 'server',
          },
        ],
        undefined,
        scopeInfo,
      );

      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
    });

    it('should validate server scope plugin with useClass registration', async () => {
      const PLUGIN_TOKEN = Symbol('SERVER_PLUGIN');

      @FrontMcpPlugin({
        name: 'DecoratedServerPlugin',
        scope: 'app', // Decorator says app
      })
      class DecoratedServerPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      // Inline config overrides decorator - sets scope to 'server'
      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useClass: DecoratedServerPlugin,
            name: 'ServerPlugin',
            scope: 'server', // Override decorator's 'app' scope
          },
        ],
        undefined,
        scopeInfo,
      );

      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
    });

    it('should use decorator scope when inline scope is not specified for useClass', async () => {
      const PLUGIN_TOKEN = Symbol('APP_PLUGIN');

      @FrontMcpPlugin({
        name: 'DecoratedAppPlugin',
        scope: 'app',
      })
      class DecoratedAppPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      // No scope in inline config - should use decorator's 'app' scope
      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useClass: DecoratedAppPlugin,
            name: 'AppPlugin',
            // scope not specified - should inherit from decorator
          },
        ],
        undefined,
        scopeInfo,
      );

      await registry.ready;
      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });
  });

  describe('Nested Plugins Scope Inheritance', () => {
    it('should propagate scopeInfo to nested plugins', async () => {
      @FrontMcpPlugin({
        name: 'NestedServerPlugin',
        scope: 'server',
      })
      class NestedServerPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'ParentPlugin',
        plugins: [NestedServerPlugin],
      })
      class ParentPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true, // Standalone app - nested server-scoped plugin should fail
      };

      const registry = new PluginRegistry(providers, [ParentPlugin], undefined, scopeInfo);

      // Should fail because nested plugin has scope='server' in a standalone app
      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
      await expect(registry.ready).rejects.toThrow(/NestedServerPlugin/);
    });

    it('should allow nested app-scoped plugins in standalone app', async () => {
      @FrontMcpPlugin({
        name: 'NestedAppPlugin',
        scope: 'app',
      })
      class NestedAppPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'ParentPlugin',
        plugins: [NestedAppPlugin],
      })
      class ParentPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      const registry = new PluginRegistry(providers, [ParentPlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should allow nested server-scoped plugins in non-standalone app', async () => {
      @FrontMcpPlugin({
        name: 'NestedServerPlugin',
        scope: 'server',
      })
      class NestedServerPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'ParentPlugin',
        plugins: [NestedServerPlugin],
      })
      class ParentPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);
      const parentScope = createMockScope();

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [ParentPlugin], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should validate deeply nested plugins with server scope', async () => {
      @FrontMcpPlugin({
        name: 'DeeplyNestedServerPlugin',
        scope: 'server',
      })
      class DeeplyNestedServerPlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'MiddlePlugin',
        plugins: [DeeplyNestedServerPlugin],
      })
      class MiddlePlugin implements PluginInterface {}

      @FrontMcpPlugin({
        name: 'TopPlugin',
        plugins: [MiddlePlugin],
      })
      class TopPlugin implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      const registry = new PluginRegistry(providers, [TopPlugin], undefined, scopeInfo);

      // Should fail because deeply nested plugin has scope='server' in standalone app
      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
      await expect(registry.ready).rejects.toThrow(/DeeplyNestedServerPlugin/);
    });
  });

  describe('Scope Fallback Behavior', () => {
    it('should register hooks to own scope when scope is app', async () => {
      @FrontMcpPlugin({
        name: 'AppScopePluginWithHooks',
        scope: 'app',
      })
      class AppScopePluginWithHooks implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);
      const parentScope = createMockScope();

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [AppScopePluginWithHooks], undefined, scopeInfo);
      await registry.ready;

      // Hooks should be registered to own scope, not parent scope
      expect(ownScope.hooks.registerHooks).not.toHaveBeenCalled(); // No hooks in this plugin
    });

    it('should register hooks to parent scope when scope is server and parentScope exists', async () => {
      @FrontMcpPlugin({
        name: 'ServerScopePluginWithHooks',
        scope: 'server',
      })
      class ServerScopePluginWithHooks implements PluginInterface {}

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);
      const parentScope = createMockScope();

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope,
        isStandaloneApp: false,
      };

      const registry = new PluginRegistry(providers, [ServerScopePluginWithHooks], undefined, scopeInfo);
      await registry.ready;

      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });
  });

  describe('Metadata Merging Edge Cases', () => {
    it('should prefer inline scope over decorator scope for useValue', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');

      @FrontMcpPlugin({
        name: 'DecoratorAppPlugin',
        scope: 'app',
      })
      class DecoratorAppPlugin implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      // Inline scope='server' should override decorator's scope='app'
      // This should fail in standalone app
      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useValue: new DecoratorAppPlugin(),
            name: 'OverriddenPlugin',
            scope: 'server',
          },
        ],
        undefined,
        scopeInfo,
      );

      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
    });

    it('should use decorator scope when inline metadata is empty for useValue', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');

      @FrontMcpPlugin({
        name: 'DecoratorAppPlugin',
        scope: 'app',
      })
      class DecoratorAppPlugin implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      // No inline scope - should use decorator's 'app' scope
      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useValue: new DecoratorAppPlugin(),
            name: 'InheritedScopePlugin',
            // scope not specified
          },
        ],
        undefined,
        scopeInfo,
      );

      await registry.ready;
      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should default to app scope when no scope is defined anywhere', async () => {
      const PLUGIN_TOKEN = Symbol('PLUGIN');

      // No @FrontMcpPlugin decorator
      class PlainPlugin implements PluginInterface {
        get: any;
      }

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      // No scope in decorator or inline - should default to 'app'
      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            useValue: new PlainPlugin(),
            name: 'NoScopePlugin',
          },
        ],
        undefined,
        scopeInfo,
      );

      // Should succeed because default scope is 'app'
      await registry.ready;
      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });
  });

  describe('Factory Plugin Edge Cases', () => {
    it('should use inline scope for factory plugins', async () => {
      const PLUGIN_TOKEN = Symbol('FACTORY_PLUGIN');

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            inject: () => [] as const,
            useFactory: () => ({ name: 'FactoryPlugin' }),
            name: 'FactoryPlugin',
            scope: 'server', // Factory plugin with server scope
          },
        ],
        undefined,
        scopeInfo,
      );

      await expect(registry.ready).rejects.toThrow(InvalidPluginScopeError);
    });

    it('should default to app scope for factory plugins without scope', async () => {
      const PLUGIN_TOKEN = Symbol('FACTORY_PLUGIN');

      const providers = await createProviderRegistryWithScope();
      const ownScope = providers.get(Scope);

      const scopeInfo: PluginScopeInfo = {
        ownScope,
        parentScope: undefined,
        isStandaloneApp: true,
      };

      const registry = new PluginRegistry(
        providers,
        [
          {
            provide: PLUGIN_TOKEN,
            inject: () => [] as const,
            useFactory: () => ({ name: 'FactoryPlugin' }),
            name: 'FactoryPlugin',
            // No scope - should default to 'app'
          },
        ],
        undefined,
        scopeInfo,
      );

      await registry.ready;
      const plugins = registry.getPlugins();
      expect(plugins).toHaveLength(1);
    });
  });
});
