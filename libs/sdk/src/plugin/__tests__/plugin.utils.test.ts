/**
 * Unit tests for plugin utilities
 */

import 'reflect-metadata';
import { normalizePlugin, collectPluginMetadata, pluginDiscoveryDeps } from '../plugin.utils';
import { FrontMcpPlugin } from '../../common/decorators/plugin.decorator';
import { PluginInterface } from '../../common/interfaces';
import { PluginKind } from '../../common/records';
import { createValueProvider } from '../../__test-utils__/fixtures/provider.fixtures';

describe('Plugin Utils', () => {
  describe('collectPluginMetadata', () => {
    it('should collect metadata from decorated plugin class', () => {
      @FrontMcpPlugin({
        name: 'TestPlugin',
        description: 'A test plugin',
      })
      class TestPlugin implements PluginInterface {}

      const metadata = collectPluginMetadata(TestPlugin);

      expect(metadata.name).toBe('TestPlugin');
      expect(metadata.description).toBe('A test plugin');
    });

    it('should collect empty metadata from undecorated class', () => {
      class PlainClass {}

      const metadata = collectPluginMetadata(PlainClass);

      // Should return an object with undefined values for undecorated class
      expect(metadata).toBeDefined();
    });

    it('should collect metadata with providers', () => {
      @FrontMcpPlugin({
        name: 'PluginWithProviders',
        description: 'Plugin with providers',
        providers: [],
      })
      class PluginWithProviders implements PluginInterface {}

      const metadata = collectPluginMetadata(PluginWithProviders);

      expect(metadata.name).toBe('PluginWithProviders');
      expect(metadata.providers).toBeDefined();
      expect(metadata.providers).toEqual([]);
    });

    it('should collect metadata with exports', () => {
      @FrontMcpPlugin({
        name: 'PluginWithExports',
        description: 'Plugin with exports',
        providers: [],
        exports: [],
      })
      class PluginWithExports implements PluginInterface {}

      const metadata = collectPluginMetadata(PluginWithExports);

      expect(metadata.name).toBe('PluginWithExports');
      expect(metadata.exports).toBeDefined();
      expect(metadata.exports).toEqual([]);
    });

    it('should collect metadata with tools, resources, and prompts', () => {
      @FrontMcpPlugin({
        name: 'FullPlugin',
        description: 'Plugin with all features',
        tools: [],
        resources: [],
        prompts: [],
      })
      class FullPlugin implements PluginInterface {}

      const metadata = collectPluginMetadata(FullPlugin);

      expect(metadata.name).toBe('FullPlugin');
      expect(metadata.tools).toBeDefined();
      expect(metadata.resources).toBeDefined();
      expect(metadata.prompts).toBeDefined();
    });
  });

  describe('normalizePlugin', () => {
    describe('Class Token Plugin', () => {
      it('should normalize a decorated class to CLASS_TOKEN kind', () => {
        @FrontMcpPlugin({
          name: 'TestPlugin',
          description: 'A test plugin',
        })
        class TestPlugin implements PluginInterface {}

        const record = normalizePlugin(TestPlugin);

        expect(record.kind).toBe(PluginKind.CLASS_TOKEN);
        expect(record.provide).toBe(TestPlugin);
        expect(record.metadata.name).toBe('TestPlugin');
        expect(record.metadata.description).toBe('A test plugin');
      });

      it('should normalize an undecorated class', () => {
        class PlainClass {}

        const record = normalizePlugin(PlainClass);

        expect(record.kind).toBe(PluginKind.CLASS_TOKEN);
        expect(record.provide).toBe(PlainClass);
      });
    });

    describe('Class Plugin with useClass', () => {
      it('should normalize a plugin object with useClass to CLASS kind', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        class TestPluginImpl implements PluginInterface {}

        const plugin = {
          provide: PLUGIN_TOKEN,
          useClass: TestPluginImpl,
          name: 'TestPlugin',
          description: 'A test plugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.CLASS);
        expect(record.provide).toBe(PLUGIN_TOKEN);
        expect((record as any).useClass).toBe(TestPluginImpl);
        expect(record.metadata.name).toBe('TestPlugin');
      });

      it('should throw error if useClass is not a class', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const plugin = {
          provide: PLUGIN_TOKEN,
          useClass: 'not a class' as any,
          name: 'TestPlugin',
        };

        expect(() => normalizePlugin(plugin)).toThrow(/must be a class/);
      });
    });

    describe('Factory Plugin', () => {
      it('should normalize a plugin object with useFactory to FACTORY kind', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const factoryFn = () => ({ name: 'test' });

        const plugin = {
          provide: PLUGIN_TOKEN,
          inject: () => [] as const,
          useFactory: factoryFn,
          name: 'FactoryPlugin',
          description: 'A factory plugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.FACTORY);
        expect(record.provide).toBe(PLUGIN_TOKEN);
        expect((record as any).useFactory).toBe(factoryFn);
        expect(record.metadata.name).toBe('FactoryPlugin');
      });

      it('should normalize a factory plugin with inject function', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');
        const DEP_TOKEN = Symbol('DEP');

        const factoryFn = (dep: any) => ({ dep });
        const injectFn = () => [DEP_TOKEN] as const;

        const plugin = {
          provide: PLUGIN_TOKEN,
          useFactory: factoryFn,
          inject: injectFn,
          name: 'FactoryPlugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.FACTORY);
        expect((record as any).inject).toBe(injectFn);
      });

      it('should use empty array as default inject if not provided', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const factoryFn = () => ({ name: 'test' });

        const plugin = {
          provide: PLUGIN_TOKEN,
          inject: () => [] as const,
          useFactory: factoryFn,
          name: 'FactoryPlugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.FACTORY);
        expect((record as any).inject()).toEqual([]);
      });

      it('should throw error if useFactory is not a function', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const plugin = {
          provide: PLUGIN_TOKEN,
          inject: () => [] as const,
          useFactory: 'not a function' as any,
          name: 'FactoryPlugin',
        };

        expect(() => normalizePlugin(plugin)).toThrow(/must be a function/);
      });
    });

    describe('Value Plugin', () => {
      it('should normalize a plugin object with useValue to VALUE kind', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const pluginValue = {
          name: 'ValuePlugin',
          getValue: () => 'value',
        };

        const plugin = {
          provide: PLUGIN_TOKEN,
          useValue: pluginValue,
          name: 'ValuePlugin',
          description: 'A value plugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.VALUE);
        expect(record.provide).toBe(PLUGIN_TOKEN);
        expect((record as any).useValue).toBe(pluginValue);
      });

      it('should throw error if useValue is null', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const plugin = {
          provide: PLUGIN_TOKEN,
          useValue: null,
          name: 'NullPlugin',
        };

        expect(() => normalizePlugin(plugin as any)).toThrow(/must be defined/);
      });

      it('should throw error if useValue is undefined', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const plugin = {
          provide: PLUGIN_TOKEN,
          useValue: undefined,
          name: 'UndefinedPlugin',
        };

        expect(() => normalizePlugin(plugin as any)).toThrow(/must be defined/);
      });

      it('should handle providers in value plugin', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');
        const SERVICE_TOKEN = Symbol('SERVICE');

        const pluginValue = {
          name: 'ValuePlugin',
        };

        const plugin = {
          provide: PLUGIN_TOKEN,
          useValue: pluginValue,
          providers: [createValueProvider(SERVICE_TOKEN, { name: 'service' }, { name: 'Service' })],
          name: 'ValuePlugin',
        };

        const record = normalizePlugin(plugin);

        expect(record.kind).toBe(PluginKind.VALUE);
        expect((record as any).providers).toBeDefined();
        expect((record as any).providers).toHaveLength(1);
      });
    });

    describe('Error Handling', () => {
      it('should throw error for plugin without provide', () => {
        const plugin = {
          useValue: { name: 'test' },
          name: 'NoProvidePlugin',
        };

        expect(() => normalizePlugin(plugin as any)).toThrow(/missing 'provide'/);
      });

      it('should throw error for plugin with no valid use* property', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const plugin = {
          provide: PLUGIN_TOKEN,
          name: 'InvalidPlugin',
        };

        expect(() => normalizePlugin(plugin as any)).toThrow(/Invalid plugin/);
      });

      it('should throw error for null plugin', () => {
        expect(() => normalizePlugin(null as any)).toThrow(/Invalid plugin/);
      });

      it('should throw error for undefined plugin', () => {
        expect(() => normalizePlugin(undefined as any)).toThrow(/Invalid plugin/);
      });

      it('should throw error for primitive plugin', () => {
        expect(() => normalizePlugin('string' as any)).toThrow(/Invalid plugin/);
        expect(() => normalizePlugin(123 as any)).toThrow(/Invalid plugin/);
        expect(() => normalizePlugin(true as any)).toThrow(/Invalid plugin/);
      });
    });
  });

  describe('pluginDiscoveryDeps', () => {
    describe('VALUE Plugin Dependencies', () => {
      it('should return empty array for VALUE plugins', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const record = normalizePlugin({
          provide: PLUGIN_TOKEN,
          useValue: { name: 'test' },
          name: 'ValuePlugin',
        });

        const deps = pluginDiscoveryDeps(record);

        expect(deps).toEqual([]);
      });
    });

    describe('FACTORY Plugin Dependencies', () => {
      it('should return injected dependencies for FACTORY plugins', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');
        const DEP1 = Symbol('DEP1');
        const DEP2 = Symbol('DEP2');

        const record = normalizePlugin({
          provide: PLUGIN_TOKEN,
          useFactory: (dep1: any, dep2: any) => ({ dep1, dep2 }),
          inject: () => [DEP1, DEP2] as const,
          name: 'FactoryPlugin',
        });

        const deps = pluginDiscoveryDeps(record);

        expect(deps).toEqual([DEP1, DEP2]);
      });

      it('should return empty array for FACTORY plugins without inject', () => {
        const PLUGIN_TOKEN = Symbol('PLUGIN');

        const record = normalizePlugin({
          provide: PLUGIN_TOKEN,
          inject: () => [] as const,
          useFactory: () => ({ name: 'test' }),
          name: 'FactoryPlugin',
        });

        const deps = pluginDiscoveryDeps(record);

        expect(deps).toEqual([]);
      });
    });

    describe('CLASS Plugin Dependencies', () => {
      it('should return empty array for plugins without dependencies', () => {
        class TestPlugin implements PluginInterface {
          constructor() {}
        }

        const PLUGIN_TOKEN = Symbol('PLUGIN');
        const record = normalizePlugin({
          provide: PLUGIN_TOKEN,
          useClass: TestPlugin,
          name: 'ClassPlugin',
        });

        const deps = pluginDiscoveryDeps(record);

        expect(deps).toEqual([]);
      });

      it('should filter dependencies based on type', () => {
        class TestPlugin implements PluginInterface {
          constructor(
            public dep1: any,
            public primitive: string,
          ) {}
        }

        // Set metadata with mixed types
        Reflect.defineMetadata('design:paramtypes', [Object, String], TestPlugin);

        const PLUGIN_TOKEN = Symbol('PLUGIN');
        const record = normalizePlugin({
          provide: PLUGIN_TOKEN,
          useClass: TestPlugin,
          name: 'ClassPlugin',
        });

        const deps = pluginDiscoveryDeps(record);

        // Should filter out primitive types like String
        expect(deps).not.toContain(String);
      });
    });

    describe('CLASS_TOKEN Plugin Dependencies', () => {
      it('should return empty array for CLASS_TOKEN plugin without dependencies', () => {
        @FrontMcpPlugin({
          name: 'TestPlugin',
          description: 'Test plugin',
        })
        class TestPlugin implements PluginInterface {
          constructor() {}
        }

        const record = normalizePlugin(TestPlugin);

        const deps = pluginDiscoveryDeps(record);

        expect(deps).toEqual([]);
      });

      it('should filter out null and undefined dependencies', () => {
        @FrontMcpPlugin({
          name: 'TestPlugin',
          description: 'Test plugin',
        })
        class TestPlugin implements PluginInterface {
          constructor(
            public dep1: any,
            public nullable: any,
          ) {}
        }

        // Set metadata with null
        Reflect.defineMetadata('design:paramtypes', [Object, null], TestPlugin);

        const record = normalizePlugin(TestPlugin);

        const deps = pluginDiscoveryDeps(record);

        // Should filter out null
        expect(deps).not.toContain(null);
      });

      it('should filter out primitive types from dependencies', () => {
        @FrontMcpPlugin({
          name: 'TestPlugin',
          description: 'Test plugin',
        })
        class TestPlugin implements PluginInterface {
          constructor(
            public dep1: any,
            public stringDep: string,
          ) {}
        }

        // Set metadata with primitive type
        Reflect.defineMetadata('design:paramtypes', [Object, String], TestPlugin);

        const record = normalizePlugin(TestPlugin);

        const deps = pluginDiscoveryDeps(record);

        // Should filter out String primitive
        expect(deps).not.toContain(String);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle complex plugin with all metadata types', () => {
      @FrontMcpPlugin({
        name: 'ComplexPlugin',
        description: 'A complex plugin with all features',
        providers: [],
        exports: [],
        plugins: [],
        adapters: [],
        tools: [],
        resources: [],
        prompts: [],
      })
      class ComplexPlugin implements PluginInterface {}

      const record = normalizePlugin(ComplexPlugin);

      expect(record.kind).toBe(PluginKind.CLASS_TOKEN);
      expect(record.metadata.name).toBe('ComplexPlugin');
      expect(record.metadata.description).toBe('A complex plugin with all features');
      expect(record.metadata.providers).toBeDefined();
      expect(record.metadata.exports).toBeDefined();
      expect(record.metadata.plugins).toBeDefined();
      expect(record.metadata.adapters).toBeDefined();
      expect(record.metadata.tools).toBeDefined();
      expect(record.metadata.resources).toBeDefined();
      expect(record.metadata.prompts).toBeDefined();
    });

    it('should handle plugin normalization and dependency extraction together', () => {
      @FrontMcpPlugin({
        name: 'DependentPlugin',
        description: 'Plugin with dependencies',
      })
      class DependentPlugin implements PluginInterface {
        constructor() {}
      }

      const record = normalizePlugin(DependentPlugin);
      const deps = pluginDiscoveryDeps(record);

      expect(record.kind).toBe(PluginKind.CLASS_TOKEN);
      expect(Array.isArray(deps)).toBe(true);
    });
  });
});
