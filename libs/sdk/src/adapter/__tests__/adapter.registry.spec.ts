/**
 * Unit tests for AdapterRegistry
 */

import 'reflect-metadata';
import AdapterRegistry from '../adapter.registry';
import { AdapterInstance } from '../adapter.instance';
import { AdapterInterface, FrontMcpAdapterResponse, FrontMcpLogger, AdapterKind } from '../../common';
import { Adapter } from '../../common/decorators/adapter.decorator';
import { createMockProviderRegistry, addProviderToMock } from '../../__test-utils__';
import { GenericServerError } from '../../errors';

// Track instances created
let mockAdapterInstances: unknown[] = [];

jest.mock('../adapter.instance', () => {
  return {
    AdapterInstance: jest.fn().mockImplementation(function (
      this: Record<string, unknown>,
      record: unknown,
      deps: unknown,
      providers: unknown,
    ) {
      this.record = record;
      this.deps = deps;
      this.globalProviders = providers;
      this.ready = Promise.resolve();
      this.getTools = jest.fn().mockReturnValue({ getTools: () => [] });
      this.getResources = jest.fn().mockReturnValue({ getResources: () => [] });
      this.getPrompts = jest.fn().mockReturnValue({ getPrompts: () => [] });
      mockAdapterInstances.push(this);
    }),
  };
});

/** Minimal adapter class for testing */
class StubAdapter implements AdapterInterface {
  options = { name: 'stub' };
  fetch(): FrontMcpAdapterResponse {
    return { tools: [] };
  }
}

/** Creates a mock logger */
function createMockLogger(): FrontMcpLogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    verbose: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as FrontMcpLogger;
}

describe('AdapterRegistry', () => {
  let mockProviders: ReturnType<typeof createMockProviderRegistry>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdapterInstances = [];
    mockProviders = createMockProviderRegistry({
      resolveBootstrapDep: jest.fn().mockResolvedValue('resolved-dep'),
    });
  });

  describe('Basic registration', () => {
    it('should return empty adapters list for empty input', async () => {
      const registry = new AdapterRegistry(mockProviders, []);
      await registry.ready;

      expect(registry.getAdapters()).toEqual([]);
    });

    it('should register a single adapter', async () => {
      @Adapter({ name: 'TestAdapter' })
      class TestAdapter extends StubAdapter {}

      const registry = new AdapterRegistry(mockProviders, [TestAdapter]);
      await registry.ready;

      expect(registry.getAdapters()).toHaveLength(1);
      expect(AdapterInstance).toHaveBeenCalledTimes(1);
    });

    it('should register multiple adapters and initialize them in parallel', async () => {
      @Adapter({ name: 'Adapter1' })
      class Adapter1 extends StubAdapter {}

      @Adapter({ name: 'Adapter2' })
      class Adapter2 extends StubAdapter {}

      @Adapter({ name: 'Adapter3' })
      class Adapter3 extends StubAdapter {}

      const registry = new AdapterRegistry(mockProviders, [Adapter1, Adapter2, Adapter3]);
      await registry.ready;

      expect(registry.getAdapters()).toHaveLength(3);
      expect(AdapterInstance).toHaveBeenCalledTimes(3);
    });

    it('should register value-based adapters', async () => {
      const TOKEN = Symbol('ADAPTER');
      const adapterValue = new StubAdapter();

      const registry = new AdapterRegistry(mockProviders, [
        {
          provide: TOKEN,
          useValue: adapterValue,
          name: 'ValueAdapter',
        },
      ]);
      await registry.ready;

      expect(registry.getAdapters()).toHaveLength(1);
    });

    it('should register factory-based adapters', async () => {
      const TOKEN = Symbol('ADAPTER');

      const registry = new AdapterRegistry(mockProviders, [
        {
          provide: TOKEN,
          useFactory: () => new StubAdapter(),
          inject: () => [] as const,
          name: 'FactoryAdapter',
        },
      ]);
      await registry.ready;

      expect(registry.getAdapters()).toHaveLength(1);
    });
  });

  describe('Dependency graph', () => {
    it('should handle adapter with satisfied dependency', async () => {
      const DEP_TOKEN = Symbol('DEP');
      addProviderToMock(mockProviders, DEP_TOKEN, 'dep-value');

      @Adapter({ name: 'DepAdapter' })
      class DepAdapter extends StubAdapter {
        constructor(public dep: unknown) {
          super();
        }
      }

      Reflect.defineMetadata('design:paramtypes', [Object], DepAdapter);
      // Discovery deps for CLASS_TOKEN uses depsOfClass which reads design:paramtypes.
      // Since Object is a primitive in discovery, it won't be graphed. Let's use a factory instead.
      const TOKEN = Symbol('ADAPTER');
      const registry = new AdapterRegistry(mockProviders, [
        {
          provide: TOKEN,
          useFactory: (_dep: unknown) => new StubAdapter(),
          inject: () => [DEP_TOKEN] as const,
          name: 'DepAdapter',
        },
      ]);
      await registry.ready;

      expect(registry.getAdapters()).toHaveLength(1);
    });

    it('should throw for adapter with missing dependency', () => {
      const DEP_TOKEN = Symbol('MISSING_DEP');

      // Override mock to throw for unknown tokens (matching real ProviderRegistry.get behavior)
      const originalGet = (mockProviders.get as jest.Mock).getMockImplementation();
      (mockProviders.get as jest.Mock).mockImplementation((token: unknown) => {
        if (token === DEP_TOKEN) {
          throw new Error(`Provider "${String(token)}" is not available`);
        }
        return originalGet?.(token);
      });

      expect(() => {
        new AdapterRegistry(mockProviders, [
          {
            provide: Symbol('ADAPTER'),
            useFactory: (_dep: unknown) => new StubAdapter(),
            inject: () => [DEP_TOKEN] as const,
            name: 'MissingDepAdapter',
          },
        ]);
      }).toThrow(/not available/);
    });
  });

  describe('Error propagation', () => {
    it('should reject ready if one adapter instance rejects', async () => {
      const rejectError = new GenericServerError('Init failed');

      // Override mock to reject for one instance
      (AdapterInstance as unknown as jest.Mock).mockImplementationOnce(function (this: Record<string, unknown>) {
        this.ready = Promise.reject(rejectError);
        mockAdapterInstances.push(this);
      });

      @Adapter({ name: 'FailAdapter' })
      class FailAdapter extends StubAdapter {}

      const registry = new AdapterRegistry(mockProviders, [FailAdapter]);
      await expect(registry.ready).rejects.toThrow('Init failed');
    });
  });

  describe('Defensive null checks', () => {
    it('should throw if defs map is corrupted during buildGraph', () => {
      @Adapter({ name: 'CorruptAdapter' })
      class CorruptAdapter extends StubAdapter {}

      // We create a subclass to access protected fields
      class TestableAdapterRegistry extends AdapterRegistry {
        corruptDefs() {
          this.defs.clear();
        }

        triggerBuildGraph() {
          this.buildGraph();
        }
      }

      const registry = new TestableAdapterRegistry(mockProviders, [CorruptAdapter]);
      // Corrupt the defs map after buildMap but we can trigger buildGraph again
      registry.corruptDefs();

      expect(() => registry.triggerBuildGraph()).toThrow(/Definition not found for token/);
    });

    it('should throw if graph map is corrupted during buildGraph', () => {
      const DEP_TOKEN = Symbol('DEP');
      addProviderToMock(mockProviders, DEP_TOKEN, 'dep-value');

      class TestableAdapterRegistry extends AdapterRegistry {
        corruptGraph() {
          this.graph.clear();
        }

        setDefsForGraphTest() {
          // Re-add a def that has factory deps so buildGraph enters the inner loop
          const token = [...this.tokens][0];
          if (token) {
            this.defs.set(token, {
              kind: AdapterKind.FACTORY,
              provide: token,
              inject: () => [DEP_TOKEN],
              useFactory: () => new StubAdapter(),
              metadata: { name: 'test' },
            });
          }
        }

        triggerBuildGraph() {
          this.buildGraph();
        }
      }

      const TOKEN = Symbol('ADAPTER');
      const registry = new TestableAdapterRegistry(mockProviders, [
        {
          provide: TOKEN,
          useFactory: () => new StubAdapter(),
          inject: () => [DEP_TOKEN] as const,
          name: 'GraphCorruptAdapter',
        },
      ]);

      registry.corruptGraph();
      registry.setDefsForGraphTest();

      expect(() => registry.triggerBuildGraph()).toThrow(/Graph entry not found for token/);
    });

    it('should throw if defs map is corrupted during initialize', async () => {
      class TestableAdapterRegistry extends AdapterRegistry {
        corruptDefs() {
          this.defs.clear();
        }

        async triggerInitialize() {
          return this.initialize();
        }
      }

      @Adapter({ name: 'CorruptInit' })
      class CorruptInit extends StubAdapter {}

      const registry = new TestableAdapterRegistry(mockProviders, [CorruptInit]);
      await registry.ready; // Let normal init complete

      registry.corruptDefs();
      await expect(registry.triggerInitialize()).rejects.toThrow(/Definition not found for token/);
    });

    it('should throw if graph map is corrupted during initialize', async () => {
      class TestableAdapterRegistry extends AdapterRegistry {
        corruptGraph() {
          this.graph.clear();
        }

        async triggerInitialize() {
          return this.initialize();
        }
      }

      @Adapter({ name: 'CorruptGraph' })
      class CorruptGraph extends StubAdapter {}

      const registry = new TestableAdapterRegistry(mockProviders, [CorruptGraph]);
      await registry.ready; // Let normal init complete

      registry.corruptGraph();
      await expect(registry.triggerInitialize()).rejects.toThrow(/Graph entry not found for token/);
    });
  });

  describe('Logging', () => {
    it('should log adapter count on construction', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      @Adapter({ name: 'LogAdapter1' })
      class LogAdapter1 extends StubAdapter {}

      @Adapter({ name: 'LogAdapter2' })
      class LogAdapter2 extends StubAdapter {}

      const registry = new AdapterRegistry(mockProviders, [LogAdapter1, LogAdapter2]);
      await registry.ready;

      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('2 adapter(s) registered'));
    });

    it('should log initialization complete at verbose level', async () => {
      const logger = createMockLogger();
      addProviderToMock(mockProviders, FrontMcpLogger, logger);

      const registry = new AdapterRegistry(mockProviders, []);
      await registry.ready;

      expect(logger.verbose).toHaveBeenCalledWith(expect.stringContaining('initialization complete'));
    });
  });
});
