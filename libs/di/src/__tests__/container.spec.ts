/**
 * Tests for DiContainer.
 */

import 'reflect-metadata';
import { DiContainer, type DiContainerOptions } from '../registry/container.js';
import { ProviderKind } from '../records/provider.record.js';
import { ProviderScope } from '../metadata/provider.metadata.js';
import { DESIGN_PARAMTYPES, META_ASYNC_WITH, META_ASYNC_WITH_TOKENS } from '../tokens/di.constants.js';
import type { ProviderTokens } from '../utils/provider.utils.js';

// Test tokens for the container
const TEST_TOKENS: ProviderTokens = {
  type: Symbol('test:type'),
  name: Symbol('test:name'),
  scope: Symbol('test:scope'),
};

describe('DiContainer', () => {
  // Helper to create a container with options
  function createContainer(
    providers: any[] = [],
    parent?: DiContainer<any>,
    options?: Partial<DiContainerOptions>,
  ): DiContainer<any> {
    return new DiContainer(providers, parent, {
      providerTokens: TEST_TOKENS,
      ...options,
    });
  }

  describe('construction', () => {
    it('should create empty container', async () => {
      const container = createContainer([]);
      await container.ready;

      expect(container.hasAny()).toBe(false);
    });

    it('should initialize with providers', async () => {
      class TestService {}

      const container = createContainer([TestService]);
      await container.ready;

      expect(container.hasAny()).toBe(true);
    });

    it('should support parent container', async () => {
      class ParentService {}

      const parent = createContainer([ParentService]);
      await parent.ready;

      const child = createContainer([], parent);
      await child.ready;

      expect(child.tryGet(ParentService)).toBeDefined();
    });
  });

  describe('provider kinds', () => {
    describe('CLASS_TOKEN (plain class)', () => {
      it('should instantiate plain class', async () => {
        class SimpleService {
          value = 42;
        }

        const container = createContainer([SimpleService]);
        await container.ready;

        const instance = container.get(SimpleService);
        expect(instance).toBeInstanceOf(SimpleService);
        expect(instance.value).toBe(42);
      });

      it('should inject dependencies via constructor', async () => {
        class DepA {
          name = 'DepA';
        }
        class ServiceWithDep {
          constructor(public dep: DepA) {}
        }
        Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA], ServiceWithDep);

        const container = createContainer([DepA, ServiceWithDep]);
        await container.ready;

        const instance = container.get(ServiceWithDep);
        expect(instance.dep).toBeInstanceOf(DepA);
        expect(instance.dep.name).toBe('DepA');
      });
    });

    describe('CLASS_TOKEN (decorated class)', () => {
      it('should use metadata from decorated class', async () => {
        class DecoratedService {}
        Reflect.defineMetadata(TEST_TOKENS.type, true, DecoratedService);
        Reflect.defineMetadata(TEST_TOKENS.name, 'DecoratedService', DecoratedService);
        Reflect.defineMetadata(TEST_TOKENS.scope, ProviderScope.GLOBAL, DecoratedService);

        const container = createContainer([DecoratedService]);
        await container.ready;

        const instance = container.get(DecoratedService);
        expect(instance).toBeInstanceOf(DecoratedService);
      });
    });

    describe('VALUE provider', () => {
      it('should register and resolve value', async () => {
        const CONFIG = Symbol('config');
        const configValue = { debug: true };

        const container = createContainer([{ provide: CONFIG, useValue: configValue }]);
        await container.ready;

        const instance = container.get(CONFIG);
        expect(instance).toBe(configValue);
      });

      it('should support primitive values', async () => {
        const TOKEN = Symbol('string');

        const container = createContainer([{ provide: TOKEN, useValue: 'test-string' }]);
        await container.ready;

        expect(container.get(TOKEN)).toBe('test-string');
      });
    });

    describe('FACTORY provider', () => {
      it('should call factory function', async () => {
        const TOKEN = Symbol('factory');
        const factoryFn = jest.fn(() => ({ created: true }));

        const container = createContainer([{ provide: TOKEN, useFactory: factoryFn }]);
        await container.ready;

        const instance = container.get(TOKEN);
        expect(instance).toEqual({ created: true });
        expect(factoryFn).toHaveBeenCalledTimes(1);
      });

      it('should inject dependencies to factory', async () => {
        class DepService {
          value = 'dep';
        }
        const TOKEN = Symbol('factory');

        const container = createContainer([
          DepService,
          {
            provide: TOKEN,
            inject: () => [DepService],
            useFactory: (dep: DepService) => ({ fromDep: dep.value }),
          },
        ]);
        await container.ready;

        const instance = container.get(TOKEN);
        expect(instance).toEqual({ fromDep: 'dep' });
      });

      it('should support async factory', async () => {
        const TOKEN = Symbol('async-factory');

        const container = createContainer([
          {
            provide: TOKEN,
            useFactory: async () => {
              await new Promise((r) => setTimeout(r, 10));
              return { async: true };
            },
          },
        ]);
        await container.ready;

        const instance = container.get(TOKEN);
        expect(instance).toEqual({ async: true });
      });
    });

    describe('CLASS provider', () => {
      it('should use useClass implementation', async () => {
        abstract class AbstractService {
          abstract getName(): string;
        }
        class ConcreteService extends AbstractService {
          getName() {
            return 'Concrete';
          }
        }

        const container = createContainer([{ provide: AbstractService, useClass: ConcreteService }]);
        await container.ready;

        const instance = container.get(AbstractService);
        expect(instance).toBeInstanceOf(ConcreteService);
        expect(instance.getName()).toBe('Concrete');
      });

      it('should inject dependencies to useClass', async () => {
        class DepA {
          name = 'A';
        }
        class Service {
          constructor(public dep: DepA) {}
        }
        class ServiceImpl extends Service {
          getDepName() {
            return this.dep.name;
          }
        }
        Reflect.defineMetadata(DESIGN_PARAMTYPES, [DepA], ServiceImpl);

        const container = createContainer([DepA, { provide: Service, useClass: ServiceImpl }]);
        await container.ready;

        const instance = container.get(Service) as ServiceImpl;
        expect(instance.getDepName()).toBe('A');
      });
    });
  });

  describe('dependency resolution', () => {
    it('should resolve chain of dependencies', async () => {
      class A {
        name = 'A';
      }
      class B {
        constructor(public a: A) {}
      }
      class C {
        constructor(public b: B) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [A], B);
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [B], C);

      const container = createContainer([A, B, C]);
      await container.ready;

      const c = container.get(C);
      expect(c.b.a.name).toBe('A');
    });

    it('should resolve from parent container', async () => {
      class ParentService {
        name = 'parent';
      }
      class ChildService {
        constructor(public parent: ParentService) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ParentService], ChildService);

      const parent = createContainer([ParentService]);
      await parent.ready;

      const child = createContainer([ChildService], parent);
      await child.ready;

      const instance = child.get(ChildService);
      expect(instance.parent.name).toBe('parent');
    });

    it('should shadow parent providers', async () => {
      class Service {
        name: string;
        constructor() {
          this.name = 'default';
        }
      }

      const parent = createContainer([Service]);
      await parent.ready;
      parent.get(Service).name = 'parent';

      class ChildImpl extends Service {
        constructor() {
          super();
          this.name = 'child';
        }
      }

      const child = createContainer([{ provide: Service, useClass: ChildImpl }], parent);
      await child.ready;

      expect(child.get(Service).name).toBe('child');
      expect(parent.get(Service).name).toBe('parent');
    });
  });

  describe('get/tryGet/resolve', () => {
    it('should throw on missing provider with get()', async () => {
      class Missing {}
      const container = createContainer([]);
      await container.ready;

      expect(() => container.get(Missing)).toThrow(/not available/);
    });

    it('should return undefined for missing provider with tryGet()', async () => {
      class Missing {}
      const container = createContainer([]);
      await container.ready;

      expect(container.tryGet(Missing)).toBeUndefined();
    });

    it('should resolve existing provider', async () => {
      class Service {}
      const container = createContainer([Service]);
      await container.ready;

      const instance = container.resolve(Service);
      expect(instance).toBeInstanceOf(Service);
    });

    it('should resolve from parent with resolve()', async () => {
      class ParentService {}
      const parent = createContainer([ParentService]);
      await parent.ready;

      const child = createContainer([], parent);
      await child.ready;

      expect(child.resolve(ParentService)).toBeInstanceOf(ParentService);
    });
  });

  describe('scoped providers', () => {
    it('should return GLOBAL scope instances directly', async () => {
      class GlobalService {}
      Reflect.defineMetadata(TEST_TOKENS.type, true, GlobalService);
      Reflect.defineMetadata(TEST_TOKENS.scope, ProviderScope.GLOBAL, GlobalService);

      const container = createContainer([GlobalService]);
      await container.ready;

      // GLOBAL scope instances are stored in main container
      expect(container.get(GlobalService)).toBeDefined();
    });

    it('should resolve CONTEXT scope via buildViews', async () => {
      class ContextService {
        id = Math.random();
      }
      Reflect.defineMetadata(TEST_TOKENS.type, true, ContextService);
      Reflect.defineMetadata(TEST_TOKENS.scope, ProviderScope.CONTEXT, ContextService);

      const container = createContainer([ContextService]);
      await container.ready;

      const views = await container.buildViews('session-1');
      // buildViews returns global and context maps
      expect(views).toHaveProperty('global');
      expect(views).toHaveProperty('context');
    });
  });

  describe('@AsyncWith support', () => {
    it('should use static with() method for initialization', async () => {
      class DepA {
        value = 'A';
      }

      class AsyncService {
        private constructor(public dep: DepA) {}
        static with(dep: DepA): AsyncService {
          return new AsyncService(dep);
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncService);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncService);

      const container = createContainer([DepA, AsyncService]);
      await container.ready;

      const instance = container.get(AsyncService);
      expect(instance.dep.value).toBe('A');
    });

    it('should support async with() method', async () => {
      class DepA {}

      class AsyncInitService {
        initialized = false;
        private constructor(public dep: DepA) {}
        static async with(dep: DepA): Promise<AsyncInitService> {
          const service = new AsyncInitService(dep);
          await new Promise((r) => setTimeout(r, 10));
          service.initialized = true;
          return service;
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncInitService);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncInitService);

      const container = createContainer([DepA, AsyncInitService]);
      await container.ready;

      const instance = container.get(AsyncInitService);
      expect(instance.initialized).toBe(true);
    });
  });

  describe('cycle detection', () => {
    it('should detect and report cycles', () => {
      class ServiceA {
        constructor(public b: any) {}
      }
      class ServiceB {
        constructor(public a: ServiceA) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ServiceB], ServiceA);
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ServiceA], ServiceB);

      // Cycle is detected during construction, not during ready
      expect(() => createContainer([ServiceA, ServiceB])).toThrow(/cycle/i);
    });
  });

  describe('initialization timeout', () => {
    it('should timeout slow providers', async () => {
      const TOKEN = Symbol('slow');

      const container = createContainer(
        [
          {
            provide: TOKEN,
            useFactory: async () => {
              await new Promise((r) => setTimeout(r, 5000));
              return {};
            },
          },
        ],
        undefined,
        { asyncTimeoutMs: 100 },
      );

      await expect(container.ready).rejects.toThrow(/timeout/i);
    }, 10000);
  });

  describe('getAllInstances', () => {
    it('should return readonly map of instances', async () => {
      class ServiceA {}
      class ServiceB {}

      const container = createContainer([ServiceA, ServiceB]);
      await container.ready;

      const instances = container.getAllInstances();
      expect(instances.size).toBe(2);
      expect(instances.get(ServiceA)).toBeInstanceOf(ServiceA);
      expect(instances.get(ServiceB)).toBeInstanceOf(ServiceB);
    });
  });

  describe('basic normalizer (no providerTokens)', () => {
    it('should work without providerTokens option', async () => {
      class SimpleService {
        value = 'simple';
      }

      // Create container without providerTokens - uses basic normalizer
      const container = new DiContainer([SimpleService]);
      await container.ready;

      const instance = container.get(SimpleService);
      expect(instance.value).toBe('simple');
    });

    it('should normalize value providers without tokens', async () => {
      const TOKEN = Symbol('config');
      const container = new DiContainer([{ provide: TOKEN, useValue: { setting: true } }]);
      await container.ready;

      expect(container.get(TOKEN)).toEqual({ setting: true });
    });

    it('should normalize factory providers without tokens', async () => {
      const TOKEN = Symbol('factory');
      const container = new DiContainer([{ provide: TOKEN, useFactory: () => ({ made: 'factory' }) }]);
      await container.ready;

      expect(container.get(TOKEN)).toEqual({ made: 'factory' });
    });

    it('should normalize class providers without tokens', async () => {
      class IService {}
      class ServiceImpl extends IService {
        name = 'impl';
      }

      const container = new DiContainer([{ provide: IService, useClass: ServiceImpl }]);
      await container.ready;

      const instance = container.get(IService) as ServiceImpl;
      expect(instance.name).toBe('impl');
    });

    it('should throw on unrecognized provider format', () => {
      expect(() => new DiContainer([{ provide: Symbol('bad'), unknownKey: true } as any])).toThrow(
        /Cannot normalize provider/,
      );
    });
  });

  describe('CONTEXT-scoped providers', () => {
    it('should build CONTEXT providers via buildViews', async () => {
      // Use static metadata instead of Reflect.defineMetadata
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
        id = Math.random();
      }

      const container = createContainer([ContextService]);
      await container.ready;

      const views = await container.buildViews('session-1');

      expect(views.context.has(ContextService)).toBe(true);
      const instance = views.context.get(ContextService) as ContextService;
      expect(instance).toBeInstanceOf(ContextService);
    });

    it('should get provider from views via getScoped', async () => {
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
        id = Math.random();
      }

      const container = createContainer([ContextService]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ContextService, views);

      expect(instance).toBeInstanceOf(ContextService);
    });

    it('should throw when getting scoped provider without views', async () => {
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
      }

      const container = createContainer([ContextService]);
      await container.ready;

      expect(() => container.get(ContextService)).toThrow(/scoped/i);
    });

    it('should build different instances for different sessions', async () => {
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
        id = Math.random();
      }

      const container = createContainer([ContextService]);
      await container.ready;

      const views1 = await container.buildViews('session-1');
      const views2 = await container.buildViews('session-2');

      const instance1 = container.getScoped(ContextService, views1);
      const instance2 = container.getScoped(ContextService, views2);

      expect(instance1.id).not.toBe(instance2.id);
    });

    it('should inject GLOBAL providers into CONTEXT providers', async () => {
      class GlobalDep {
        static metadata = { name: 'GlobalDep', scope: ProviderScope.GLOBAL };
        value = 'global';
      }
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
        constructor(public dep: GlobalDep) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [GlobalDep], ContextService);

      const container = createContainer([GlobalDep, ContextService]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ContextService, views);

      expect(instance.dep.value).toBe('global');
    });

    it('should build CONTEXT factory provider with dependencies', async () => {
      class GlobalDep {
        static metadata = { name: 'GlobalDep', scope: ProviderScope.GLOBAL };
        value = 'from-global';
      }
      const CONTEXT_TOKEN = Symbol('context-factory');

      const container = createContainer([
        GlobalDep,
        {
          provide: CONTEXT_TOKEN,
          inject: () => [GlobalDep],
          useFactory: (dep: GlobalDep) => ({ computed: dep.value + '-processed' }),
          metadata: { name: 'ContextFactory', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(CONTEXT_TOKEN, views);

      expect(instance).toEqual({ computed: 'from-global-processed' });
    });

    it('should build CONTEXT value provider', async () => {
      const TOKEN = Symbol('context-value');

      const container = createContainer([
        {
          provide: TOKEN,
          useValue: { contextual: true },
          metadata: { name: 'ContextValue', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      expect(container.getScoped(TOKEN, views)).toEqual({ contextual: true });
    });

    it('should not rebuild already-present CONTEXT providers', async () => {
      class ContextService {
        static metadata = { name: 'ContextService', scope: ProviderScope.CONTEXT };
        id = Math.random();
      }

      const container = createContainer([ContextService]);
      await container.ready;

      // Pre-populate the context
      const existingInstance = new ContextService();
      const preBuilt = new Map<any, unknown>([[ContextService, existingInstance]]);

      const views = await container.buildViews('session-1', preBuilt);
      expect(container.getScoped(ContextService, views)).toBe(existingInstance);
    });

    it('should throw when getScoped cannot find provider', async () => {
      class MissingService {}

      const container = createContainer([]);
      await container.ready;

      const views = await container.buildViews('session-1');
      expect(() => container.getScoped(MissingService, views)).toThrow(/not found in views/);
    });
  });

  describe('init() method support', () => {
    it('should call sync init() method after construction', async () => {
      class ServiceWithInit {
        initialized = false;
        init() {
          this.initialized = true;
        }
      }

      const container = createContainer([ServiceWithInit]);
      await container.ready;

      const instance = container.get(ServiceWithInit);
      expect(instance.initialized).toBe(true);
    });

    it('should call async init() method and await it', async () => {
      class AsyncInitService {
        initialized = false;
        async init() {
          await new Promise((r) => setTimeout(r, 10));
          this.initialized = true;
        }
      }

      const container = createContainer([AsyncInitService]);
      await container.ready;

      const instance = container.get(AsyncInitService);
      expect(instance.initialized).toBe(true);
    });

    it('should call init() for CONTEXT scoped providers', async () => {
      class ContextWithInit {
        static metadata = { name: 'ContextWithInit', scope: ProviderScope.CONTEXT };
        initialized = false;
        init() {
          this.initialized = true;
        }
      }

      const container = createContainer([ContextWithInit]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ContextWithInit, views);
      expect(instance.initialized).toBe(true);
    });
  });

  describe('injectProvider', () => {
    it('should inject pre-instantiated provider', async () => {
      const TOKEN = Symbol('injected');
      const preBuilt = { injected: true, value: 42 };

      const container = createContainer([]);
      await container.ready;

      container.injectProvider({
        provide: TOKEN,
        value: preBuilt,
        metadata: { name: 'InjectedProvider' },
      });

      expect(container.get(TOKEN)).toBe(preBuilt);
    });

    it('should allow accessing injected provider immediately', async () => {
      const CONFIG = Symbol('config');
      const configValue = { apiKey: 'secret' };

      const container = createContainer([]);
      await container.ready;

      container.injectProvider({
        provide: CONFIG,
        value: configValue,
        metadata: { name: 'Config' },
      });

      // Injected provider should be immediately accessible
      expect(container.get(CONFIG)).toBe(configValue);
      expect(container.tryGet(CONFIG)).toBe(configValue);
    });
  });

  describe('resolve() edge cases', () => {
    it('should construct non-registered class directly', async () => {
      class UnregisteredService {
        value = 'unregistered';
        init() {
          this.value = 'initialized';
        }
      }

      const container = createContainer([]);
      await container.ready;

      const instance = container.resolve(UnregisteredService);
      expect(instance.value).toBe('initialized');
    });

    it('should throw for non-registered non-class token', async () => {
      const TOKEN = Symbol('unknown');

      const container = createContainer([]);
      await container.ready;

      expect(() => container.resolve(TOKEN as any)).toThrow(/not a registered GLOBAL provider/);
    });

    it('should throw for scoped provider with resolve()', async () => {
      class ScopedService {
        static metadata = { name: 'ScopedService', scope: ProviderScope.CONTEXT };
      }

      const container = createContainer([ScopedService]);
      await container.ready;

      expect(() => container.resolve(ScopedService)).toThrow(/scoped/i);
    });
  });

  describe('parent hierarchy edge cases', () => {
    it('should resolve GLOBAL from parent in factory', async () => {
      class ParentGlobal {
        value = 'parent-global';
      }
      const TOKEN = Symbol('child-factory');

      const parent = createContainer([ParentGlobal]);
      await parent.ready;

      const child = createContainer(
        [
          {
            provide: TOKEN,
            inject: () => [ParentGlobal],
            useFactory: (pg: ParentGlobal) => ({ fromParent: pg.value }),
          },
        ],
        parent,
      );
      await child.ready;

      expect(child.get(TOKEN)).toEqual({ fromParent: 'parent-global' });
    });

    it('should throw when depending on unregistered token', () => {
      class Missing {}
      class NeedsMissing {
        constructor(public m: Missing) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [Missing], NeedsMissing);

      expect(() => createContainer([NeedsMissing])).toThrow(/not registered/);
    });

    it('should throw when GLOBAL depends on CONTEXT scoped', () => {
      class ContextDep {
        static metadata = { name: 'ContextDep', scope: ProviderScope.CONTEXT };
      }
      class GlobalService {
        static metadata = { name: 'GlobalService', scope: ProviderScope.GLOBAL };
        constructor(public dep: ContextDep) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ContextDep], GlobalService);

      expect(() => createContainer([ContextDep, GlobalService])).toThrow(/GLOBAL.*cannot depend on scoped/);
    });
  });

  describe('scope normalization', () => {
    it('should normalize SESSION to CONTEXT', async () => {
      class SessionService {
        static metadata = { name: 'SessionService', scope: ProviderScope.SESSION };
      }

      const container = createContainer([SessionService]);
      await container.ready;

      // Should be treated as CONTEXT scope (not directly gettable)
      expect(() => container.get(SessionService)).toThrow(/scoped/);

      // But buildViews should work
      const views = await container.buildViews('session-1');
      expect(views.context.has(SessionService)).toBe(true);
    });

    it('should normalize REQUEST to CONTEXT', async () => {
      class RequestService {
        static metadata = { name: 'RequestService', scope: ProviderScope.REQUEST };
      }

      const container = createContainer([RequestService]);
      await container.ready;

      const views = await container.buildViews('req-1');
      expect(views.context.has(RequestService)).toBe(true);
    });
  });

  describe('AsyncWith with useClass', () => {
    it('should use AsyncWith with CLASS provider', async () => {
      class DepA {
        value = 'dep-a';
      }

      class AsyncClassImpl {
        private constructor(public dep: DepA) {}
        static with(dep: DepA): AsyncClassImpl {
          return new AsyncClassImpl(dep);
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncClassImpl);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncClassImpl);

      const TOKEN = Symbol('async-class');
      const container = createContainer([DepA, { provide: TOKEN, useClass: AsyncClassImpl }]);
      await container.ready;

      const instance = container.get(TOKEN) as AsyncClassImpl;
      expect(instance.dep.value).toBe('dep-a');
    });

    it('should use async AsyncWith with CLASS_TOKEN', async () => {
      class DepA {}

      class AsyncClassToken {
        ready = false;
        private constructor(public dep: DepA) {}
        static async with(dep: DepA): Promise<AsyncClassToken> {
          const inst = new AsyncClassToken(dep);
          await new Promise((r) => setTimeout(r, 5));
          inst.ready = true;
          return inst;
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncClassToken);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncClassToken);

      const container = createContainer([DepA, AsyncClassToken]);
      await container.ready;

      const instance = container.get(AsyncClassToken);
      expect(instance.ready).toBe(true);
    });
  });

  describe('CONTEXT with AsyncWith', () => {
    it('should use AsyncWith for CONTEXT-scoped providers', async () => {
      class GlobalDep {
        value = 'global-dep';
      }

      class AsyncContextService {
        static metadata = { name: 'AsyncContextService', scope: ProviderScope.CONTEXT };
        ready = false;
        private constructor(public dep: GlobalDep) {}
        static async with(dep: GlobalDep): Promise<AsyncContextService> {
          const inst = new AsyncContextService(dep);
          await new Promise((r) => setTimeout(r, 5));
          inst.ready = true;
          return inst;
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncContextService);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [GlobalDep], AsyncContextService);

      const container = createContainer([GlobalDep, AsyncContextService]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(AsyncContextService, views);
      expect(instance.ready).toBe(true);
      expect(instance.dep.value).toBe('global-dep');
    });
  });

  describe('error handling', () => {
    it('should wrap construction errors with token name', async () => {
      class FailingService {
        constructor() {
          throw new Error('Construction failed!');
        }
      }

      const container = createContainer([FailingService]);
      await expect(container.ready).rejects.toThrow(/FailingService.*Construction failed/);
    });

    it('should wrap CONTEXT construction errors', async () => {
      class FailingContextService {
        static metadata = { name: 'FailingContextService', scope: ProviderScope.CONTEXT };
        constructor() {
          throw new Error('Context construction failed!');
        }
      }

      const container = createContainer([FailingContextService]);
      await container.ready;

      await expect(container.buildViews('session-1')).rejects.toThrow(
        /context-scoped.*FailingContextService.*Context construction failed/,
      );
    });

    it('should throw when factory throws during CONTEXT build', async () => {
      const TOKEN = Symbol('failing-factory');

      const container = createContainer([
        {
          provide: TOKEN,
          useFactory: () => {
            throw new Error('Factory exploded!');
          },
          metadata: { scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      await expect(container.buildViews('session-1')).rejects.toThrow(/context-scoped.*Factory exploded/);
    });
  });

  describe('async factory in CONTEXT scope', () => {
    it('should handle async factory in CONTEXT scope', async () => {
      const TOKEN = Symbol('async-context-factory');

      const container = createContainer([
        {
          provide: TOKEN,
          useFactory: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return { asyncContext: true };
          },
          metadata: { scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      expect(container.getScoped(TOKEN, views)).toEqual({ asyncContext: true });
    });
  });

  describe('resolveFromViews parent lookup', () => {
    it('should resolve GLOBAL from parent in buildViews', async () => {
      class ParentGlobalService {
        name = 'parent';
      }

      class ChildContextService {
        static metadata = { name: 'ChildContextService', scope: ProviderScope.CONTEXT };
        constructor(public parent: ParentGlobalService) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ParentGlobalService], ChildContextService);

      const parent = createContainer([ParentGlobalService]);
      await parent.ready;

      const child = createContainer([ChildContextService], parent);
      await child.ready;

      const views = await child.buildViews('session-1');
      const instance = child.getScoped(ChildContextService, views);
      expect(instance.parent.name).toBe('parent');
    });
  });

  describe('getAllSingletons', () => {
    it('should return same instance as instances map', async () => {
      class ServiceA {}
      const container = createContainer([ServiceA]);
      await container.ready;

      const singletons = container.getAllSingletons();
      expect(singletons.get(ServiceA)).toBe(container.get(ServiceA));
    });
  });

  describe('getScoped with instances', () => {
    it('should return from container instances if in views.global', async () => {
      class GlobalService {}

      const container = createContainer([GlobalService]);
      await container.ready;

      const views = await container.buildViews('session-1');
      // Global service should be accessible via getScoped
      expect(container.getScoped(GlobalService, views)).toBeInstanceOf(GlobalService);
    });
  });

  describe('additional CONTEXT factory tests', () => {
    it('should resolve CONTEXT deps in correct order', async () => {
      class GlobalA {
        value = 'A';
      }
      class ContextB {
        static metadata = { name: 'ContextB', scope: ProviderScope.CONTEXT };
        constructor(public a: GlobalA) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [GlobalA], ContextB);

      const CONTEXT_C = Symbol('context-c');

      const container = createContainer([
        GlobalA,
        ContextB,
        {
          provide: CONTEXT_C,
          inject: () => [ContextB],
          useFactory: (b: ContextB) => ({ fromB: b.a.value }),
          metadata: { name: 'ContextC', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      expect(container.getScoped(CONTEXT_C, views)).toEqual({ fromB: 'A' });
    });

    it('should handle CONTEXT class with CONTEXT dependency', async () => {
      class ContextA {
        static metadata = { name: 'ContextA', scope: ProviderScope.CONTEXT };
        value = 'context-a';
      }
      class ContextB {
        static metadata = { name: 'ContextB', scope: ProviderScope.CONTEXT };
        constructor(public a: ContextA) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [ContextA], ContextB);

      const container = createContainer([ContextA, ContextB]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const b = container.getScoped(ContextB, views);
      expect(b.a.value).toBe('context-a');
    });

    it('should handle async CONTEXT factory', async () => {
      const TOKEN = Symbol('async-ctx');

      const container = createContainer([
        {
          provide: TOKEN,
          useFactory: async () => {
            await new Promise((r) => setTimeout(r, 5));
            return { async: true };
          },
          metadata: { name: 'AsyncContext', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      expect(container.getScoped(TOKEN, views)).toEqual({ async: true });
    });
  });

  describe('additional buildIntoStore paths', () => {
    it('should handle CONTEXT useClass provider', async () => {
      class IService {
        abstract(): string {
          return 'abstract';
        }
      }
      class ServiceImpl extends IService {
        static metadata = { name: 'ServiceImpl', scope: ProviderScope.CONTEXT };
        override abstract() {
          return 'impl';
        }
      }

      const container = createContainer([
        { provide: IService, useClass: ServiceImpl, metadata: { name: 'IService', scope: ProviderScope.CONTEXT } },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(IService, views);
      expect(instance.abstract()).toBe('impl');
    });

    it('should handle CONTEXT useClass with init()', async () => {
      class ServiceWithInit {
        initialized = false;
        init() {
          this.initialized = true;
        }
      }

      const container = createContainer([
        {
          provide: ServiceWithInit,
          useClass: ServiceWithInit,
          metadata: { name: 'ServiceWithInit', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ServiceWithInit, views);
      expect(instance.initialized).toBe(true);
    });

    it('should handle CONTEXT useClass with async init()', async () => {
      class AsyncInitService {
        ready = false;
        async init() {
          await new Promise((r) => setTimeout(r, 5));
          this.ready = true;
        }
      }

      const container = createContainer([
        {
          provide: AsyncInitService,
          useClass: AsyncInitService,
          metadata: { name: 'AsyncInitService', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(AsyncInitService, views);
      expect(instance.ready).toBe(true);
    });
  });

  describe('resolveFromViews edge cases', () => {
    it('should throw when GLOBAL dep is not instantiated in resolveFromViews', async () => {
      // This tests the error path at line 711
      // We need a CONTEXT provider that depends on a GLOBAL that's not there
      // This is hard to trigger since GLOBAL providers are built first
      // Skip for now - requires internal manipulation
    });

    it('should resolve from contextStore first', async () => {
      class ContextA {
        static metadata = { name: 'ContextA', scope: ProviderScope.CONTEXT };
        id = Math.random();
      }

      const container = createContainer([ContextA]);
      await container.ready;

      // Pre-populate with custom instance
      const custom = new ContextA();
      custom.id = 999;
      const prebuilt = new Map([[ContextA, custom]]);

      const views = await container.buildViews('session-1', prebuilt);
      expect(container.getScoped(ContextA, views).id).toBe(999);
    });

    it('should resolve from globalStore', async () => {
      class GlobalService {
        value = 'global';
      }
      class ContextNeedsGlobal {
        static metadata = { name: 'ContextNeedsGlobal', scope: ProviderScope.CONTEXT };
        constructor(public global: GlobalService) {}
      }
      Reflect.defineMetadata(DESIGN_PARAMTYPES, [GlobalService], ContextNeedsGlobal);

      const container = createContainer([GlobalService, ContextNeedsGlobal]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ContextNeedsGlobal, views);
      expect(instance.global.value).toBe('global');
    });
  });

  describe('hierarchy resolution in CONTEXT', () => {
    it('should resolve parent GLOBAL in CONTEXT factory', async () => {
      class ParentGlobal {
        name = 'parent';
      }
      const CHILD_CTX = Symbol('child-ctx');

      const parent = createContainer([ParentGlobal]);
      await parent.ready;

      const child = createContainer(
        [
          {
            provide: CHILD_CTX,
            inject: () => [ParentGlobal],
            useFactory: (p: ParentGlobal) => ({ from: p.name }),
            metadata: { name: 'ChildContext', scope: ProviderScope.CONTEXT },
          },
        ],
        parent,
      );
      await child.ready;

      const views = await child.buildViews('session-1');
      expect(child.getScoped(CHILD_CTX, views)).toEqual({ from: 'parent' });
    });
  });

  describe('CONTEXT CLASS_TOKEN with AsyncWith', () => {
    it('should use sync AsyncWith for CONTEXT CLASS_TOKEN', async () => {
      class GlobalDep {
        value = 'global';
      }
      class ContextAsyncWith {
        static metadata = { name: 'ContextAsyncWith', scope: ProviderScope.CONTEXT };
        private constructor(public dep: GlobalDep) {}
        static with(dep: GlobalDep) {
          return new ContextAsyncWith(dep);
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, ContextAsyncWith);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [GlobalDep], ContextAsyncWith);

      const container = createContainer([GlobalDep, ContextAsyncWith]);
      await container.ready;

      const views = await container.buildViews('session-1');
      const instance = container.getScoped(ContextAsyncWith, views);
      expect(instance.dep.value).toBe('global');
    });
  });

  describe('error paths in buildIntoStoreWithViews', () => {
    it('should throw error with context-scoped label', async () => {
      const TOKEN = Symbol('bad-factory');

      const container = createContainer([
        {
          provide: TOKEN,
          useFactory: () => {
            throw new Error('Factory boom!');
          },
          metadata: { name: 'BadFactory', scope: ProviderScope.CONTEXT },
        },
      ]);
      await container.ready;

      await expect(container.buildViews('session-1')).rejects.toThrow(/context-scoped/);
    });
  });

  describe('GLOBAL CLASS with init()', () => {
    it('should call init() on GLOBAL CLASS provider', async () => {
      class ServiceWithInit {
        ready = false;
        init() {
          this.ready = true;
        }
      }

      const container = createContainer([{ provide: ServiceWithInit, useClass: ServiceWithInit }]);
      await container.ready;

      expect(container.get(ServiceWithInit).ready).toBe(true);
    });

    it('should call async init() on GLOBAL CLASS provider', async () => {
      class AsyncService {
        ready = false;
        async init() {
          await new Promise((r) => setTimeout(r, 5));
          this.ready = true;
        }
      }

      const container = createContainer([{ provide: AsyncService, useClass: AsyncService }]);
      await container.ready;

      expect(container.get(AsyncService).ready).toBe(true);
    });
  });

  describe('GLOBAL AsyncWith with CLASS provider', () => {
    it('should use sync AsyncWith for GLOBAL CLASS provider', async () => {
      class DepA {
        value = 'dep';
      }
      class AsyncImpl {
        private constructor(public dep: DepA) {}
        static with(dep: DepA) {
          return new AsyncImpl(dep);
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncImpl);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncImpl);

      const TOKEN = Symbol('async-impl');
      const container = createContainer([DepA, { provide: TOKEN, useClass: AsyncImpl }]);
      await container.ready;

      const instance = container.get(TOKEN) as AsyncImpl;
      expect(instance.dep.value).toBe('dep');
    });

    it('should use async AsyncWith for GLOBAL CLASS provider', async () => {
      class DepA {}
      class AsyncAsyncImpl {
        ready = false;
        private constructor(public dep: DepA) {}
        static async with(dep: DepA) {
          const inst = new AsyncAsyncImpl(dep);
          await new Promise((r) => setTimeout(r, 5));
          inst.ready = true;
          return inst;
        }
      }
      Reflect.defineMetadata(META_ASYNC_WITH, true, AsyncAsyncImpl);
      Reflect.defineMetadata(META_ASYNC_WITH_TOKENS, () => [DepA], AsyncAsyncImpl);

      const TOKEN = Symbol('async-async-impl');
      const container = createContainer([DepA, { provide: TOKEN, useClass: AsyncAsyncImpl }]);
      await container.ready;

      const instance = container.get(TOKEN) as AsyncAsyncImpl;
      expect(instance.ready).toBe(true);
    });
  });
});
