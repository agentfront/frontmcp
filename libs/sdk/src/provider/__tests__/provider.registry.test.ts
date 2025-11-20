/**
 * Unit tests for ProviderRegistry
 */

import 'reflect-metadata';
import ProviderRegistry from '../provider.registry';
import { ProviderScope } from '../../common/metadata';
import { ProviderKind } from '../../common/records';
import {
  TestService,
  DependentService,
  AsyncService,
  TEST_TOKEN,
  ASYNC_TOKEN,
  FACTORY_TOKEN,
  createValueProvider,
  createFactoryProvider,
  createClassProvider,
} from '../../__test-utils__/fixtures/provider.fixtures';

describe('ProviderRegistry', () => {
  describe('Basic Registration', () => {
    it('should register a value provider', async () => {
      const registry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'test value' }),
      ]);

      await registry.ready;

      const singletons = registry.getAllSingletons();
      expect(singletons.has(TEST_TOKEN)).toBe(true);
      expect(singletons.get(TEST_TOKEN)).toEqual({ name: 'test value' });
    });

    it('should register a factory provider', async () => {
      const registry = new ProviderRegistry([
        createFactoryProvider(FACTORY_TOKEN, () => ({ name: 'from factory' })),
      ]);

      await registry.ready;

      const singletons = registry.getAllSingletons();
      expect(singletons.has(FACTORY_TOKEN)).toBe(true);
      expect(singletons.get(FACTORY_TOKEN)).toEqual({ name: 'from factory' });
    });

    it('should register a class provider', async () => {
      const AnnotatedTestService = createClassProvider(TestService, {
        name: 'TestService',
      });

      const registry = new ProviderRegistry([AnnotatedTestService]);

      await registry.ready;

      const instance = registry.get(TestService);
      expect(instance).toBeInstanceOf(TestService);
      expect(instance.greet()).toBe('Hello from TestService');
    });

    it('should register multiple providers', async () => {
      const registry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'value1' }),
        createFactoryProvider(FACTORY_TOKEN, () => ({ name: 'value2' })),
      ]);

      await registry.ready;

      const singletons = registry.getAllSingletons();
      expect(singletons.size).toBe(2);
      expect(singletons.has(TEST_TOKEN)).toBe(true);
      expect(singletons.has(FACTORY_TOKEN)).toBe(true);
    });
  });

  describe('Dependency Resolution', () => {
    it('should resolve dependencies between providers', async () => {
      const TestServiceAnnotated = createClassProvider(TestService, {
        name: 'TestService',
      });

      const DependentServiceAnnotated = createClassProvider(DependentService, {
        name: 'DependentService',
      });

      const registry = new ProviderRegistry([
        TestServiceAnnotated,
        DependentServiceAnnotated,
      ]);

      await registry.ready;

      const dependentInstance = registry.get(DependentService);
      expect(dependentInstance).toBeInstanceOf(DependentService);
      expect(dependentInstance.testService).toBeInstanceOf(TestService);
      expect(dependentInstance.callGreet()).toBe('Hello from TestService');
    });

    it('should resolve dependencies in correct order (topological sort)', async () => {
      const initOrder: string[] = [];

      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class ServiceA {
        constructor() {
          initOrder.push('A');
        }
      }

      @Injectable()
      class ServiceB {
        constructor(public a: ServiceA) {
          initOrder.push('B');
        }
      }

      @Injectable()
      class ServiceC {
        constructor(
          public a: ServiceA,
          public b: ServiceB
        ) {
          initOrder.push('C');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(ServiceC, { name: 'ServiceC' }),
        createClassProvider(ServiceB, { name: 'ServiceB' }),
        createClassProvider(ServiceA, { name: 'ServiceA' }),
      ]);

      await registry.ready;

      // A should be initialized before B, and B before C
      expect(initOrder).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Circular Dependency Detection', () => {
    it('should detect and throw error for circular dependencies', () => {
      function Injectable() {
        return function (target: any) {};
      }

      // Declare interfaces to avoid TDZ issues
      interface IServiceA {
        b: IServiceB;
      }
      interface IServiceB {
        a: IServiceA;
      }

      @Injectable()
      class ServiceA implements IServiceA {
        constructor(public b: any) {} // Use 'any' to avoid TDZ
      }

      @Injectable()
      class ServiceB implements IServiceB {
        constructor(public a: any) {} // Use 'any' to avoid TDZ
      }

      // Manually set the design:paramtypes to create the circular reference
      Reflect.defineMetadata('design:paramtypes', [ServiceB], ServiceA);
      Reflect.defineMetadata('design:paramtypes', [ServiceA], ServiceB);

      expect(() => {
        new ProviderRegistry([
          createClassProvider(ServiceA, { name: 'ServiceA' }),
          createClassProvider(ServiceB, { name: 'ServiceB' }),
        ]);
      }).toThrow(/cycle/i);
    });

    it('should detect circular dependencies in a chain of 3+ services', () => {
      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class ServiceA {
        constructor(public c: any) {}
      }

      @Injectable()
      class ServiceB {
        constructor(public a: any) {}
      }

      @Injectable()
      class ServiceC {
        constructor(public b: any) {}
      }

      // Manually set the design:paramtypes to create the circular reference
      Reflect.defineMetadata('design:paramtypes', [ServiceC], ServiceA);
      Reflect.defineMetadata('design:paramtypes', [ServiceA], ServiceB);
      Reflect.defineMetadata('design:paramtypes', [ServiceB], ServiceC);

      expect(() => {
        new ProviderRegistry([
          createClassProvider(ServiceA, { name: 'ServiceA' }),
          createClassProvider(ServiceB, { name: 'ServiceB' }),
          createClassProvider(ServiceC, { name: 'ServiceC' }),
        ]);
      }).toThrow(/cycle/i);
    });
  });

  describe('Hierarchical Provider Lookups', () => {
    it('should resolve providers from parent registry', async () => {
      const parentRegistry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'from parent' }),
      ]);

      await parentRegistry.ready;

      const childRegistry = new ProviderRegistry(
        [createValueProvider(FACTORY_TOKEN, { name: 'from child' })],
        parentRegistry
      );

      await childRegistry.ready;

      // Child should have its own provider
      const childSingletons = childRegistry.getAllSingletons();
      expect(childSingletons.has(FACTORY_TOKEN)).toBe(true);

      // Child should not have parent's provider in its own instances
      expect(childSingletons.has(TEST_TOKEN)).toBe(false);

      // But parent should still have its provider
      const parentSingletons = parentRegistry.getAllSingletons();
      expect(parentSingletons.has(TEST_TOKEN)).toBe(true);
    });

    it('should allow child to depend on parent providers', async () => {
      const TestServiceAnnotated = createClassProvider(TestService, {
        name: 'TestService',
      });

      const parentRegistry = new ProviderRegistry([TestServiceAnnotated]);
      await parentRegistry.ready;

      const DependentServiceAnnotated = createClassProvider(DependentService, {
        name: 'DependentService',
      });

      const childRegistry = new ProviderRegistry(
        [DependentServiceAnnotated],
        parentRegistry
      );

      await childRegistry.ready;

      const dependentInstance = childRegistry.get(DependentService);
      expect(dependentInstance).toBeInstanceOf(DependentService);
      expect(dependentInstance.testService).toBeInstanceOf(TestService);
    });

    it('should throw error if dependency not found in hierarchy', () => {
      const DependentServiceAnnotated = createClassProvider(DependentService, {
        name: 'DependentService',
      });

      expect(() => {
        new ProviderRegistry([DependentServiceAnnotated]);
      }).toThrow(/not registered/i);
    });
  });

  describe('Scope Management', () => {
    it('should handle GLOBAL scope providers', async () => {
      const registry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'global' }, { scope: ProviderScope.GLOBAL }),
      ]);

      await registry.ready;

      const singletons = registry.getAllSingletons();
      expect(singletons.has(TEST_TOKEN)).toBe(true);
      const instance = singletons.get(TEST_TOKEN);
      expect(instance).toEqual({ name: 'global' });
    });

    it('should not allow GLOBAL provider to depend on SESSION provider', () => {
      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class SessionService {
        constructor() {}
      }

      @Injectable()
      class GlobalService {
        constructor(public session: SessionService) {}
      }

      const SessionServiceAnnotated = createClassProvider(SessionService, {
        name: 'SessionService',
        scope: ProviderScope.SESSION,
      });

      const GlobalServiceAnnotated = createClassProvider(GlobalService, {
        name: 'GlobalService',
        scope: ProviderScope.GLOBAL,
      });

      expect(() => {
        new ProviderRegistry([SessionServiceAnnotated, GlobalServiceAnnotated]);
      }).toThrow(/cannot depend on scoped provider/i);
    });

    it('should not allow GLOBAL provider to depend on REQUEST provider', () => {
      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class RequestService {
        constructor() {}
      }

      @Injectable()
      class GlobalService {
        constructor(public request: RequestService) {}
      }

      const RequestServiceAnnotated = createClassProvider(RequestService, {
        name: 'RequestService',
        scope: ProviderScope.REQUEST,
      });

      const GlobalServiceAnnotated = createClassProvider(GlobalService, {
        name: 'GlobalService',
        scope: ProviderScope.GLOBAL,
      });

      expect(() => {
        new ProviderRegistry([RequestServiceAnnotated, GlobalServiceAnnotated]);
      }).toThrow(/cannot depend on scoped provider/i);
    });
  });

  describe('Async Initialization', () => {
    it('should handle async provider initialization with with/init pattern', async () => {
      const AsyncServiceAnnotated = createClassProvider(AsyncService, {
        name: 'AsyncService',
      });

      const registry = new ProviderRegistry([AsyncServiceAnnotated]);

      await registry.ready;

      const asyncInstance = registry.get(AsyncService);
      expect(asyncInstance).toBeInstanceOf(AsyncService);

      // The provider should not be initialized yet (lazy initialization)
      // But it should exist in the registry
      expect(asyncInstance).toBeDefined();
    });

    it('should initialize all GLOBAL providers on bootstrap', async () => {
      const initLog: string[] = [];

      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class Service1 {
        constructor() {
          initLog.push('Service1');
        }
      }

      @Injectable()
      class Service2 {
        constructor() {
          initLog.push('Service2');
        }
      }

      @Injectable()
      class Service3 {
        constructor(public s1: Service1, public s2: Service2) {
          initLog.push('Service3');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(Service1, { name: 'Service1' }),
        createClassProvider(Service2, { name: 'Service2' }),
        createClassProvider(Service3, { name: 'Service3' }),
      ]);

      await registry.ready;

      expect(initLog).toHaveLength(3);
      expect(initLog).toContain('Service1');
      expect(initLog).toContain('Service2');
      expect(initLog).toContain('Service3');
    });
  });

  describe('Error Handling', () => {
    it('should throw error with helpful message when provider instantiation fails', async () => {
      function Injectable() {
        return function (target: any) {};
      }

      @Injectable()
      class FailingService {
        constructor() {
          throw new Error('Construction failed!');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingService, { name: 'FailingService' }),
      ]);

      await expect(registry.ready).rejects.toThrow(/Construction failed/);
    });

    it('should throw error when depending on unregistered provider', () => {
      function Injectable() {
        return function (target: any) {};
      }

      const UnregisteredToken = Symbol('UNREGISTERED');

      @Injectable()
      class UnregisteredService {}

      @Injectable()
      class ServiceNeedingUnregistered {
        constructor(public unregistered: UnregisteredService) {}
      }

      expect(() => {
        new ProviderRegistry([
          createClassProvider(ServiceNeedingUnregistered, { name: 'ServiceNeedingUnregistered' }),
        ]);
      }).toThrow(/not registered/);
    });
  });

  describe('Registry Methods', () => {
    it('should return all providers via getProviders()', async () => {
      const registry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'value1' }),
        createFactoryProvider(FACTORY_TOKEN, () => ({ name: 'value2' })),
      ]);

      await registry.ready;

      const providers = registry.getProviders();
      expect(providers).toHaveLength(2);
    });

    it('should return singleton map via getAllSingletons()', async () => {
      const registry = new ProviderRegistry([
        createValueProvider(TEST_TOKEN, { name: 'value1' }),
      ]);

      await registry.ready;

      const singletons = registry.getAllSingletons();
      expect(singletons).toBeInstanceOf(Map);
      expect(singletons.has(TEST_TOKEN)).toBe(true);
      expect(singletons.get(TEST_TOKEN)).toEqual({ name: 'value1' });
    });
  });
});
