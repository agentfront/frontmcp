/**
 * Tests for provider utilities.
 */

import 'reflect-metadata';
import {
  createProviderNormalizer,
  providerDiscoveryDeps,
  providerInvocationTokens,
  type ProviderTokens,
} from '../utils/provider.utils.js';
import { ProviderKind } from '../records/provider.record.js';
import { ProviderScope } from '../metadata/provider.metadata.js';
import type { Type } from '../interfaces/base.interface.js';

describe('provider utils', () => {
  // Test tokens
  const TEST_TOKENS: ProviderTokens = {
    type: Symbol('test:type'),
    name: Symbol('test:name'),
    scope: Symbol('test:scope'),
    description: Symbol('test:description'),
    id: Symbol('test:id'),
  };

  describe('createProviderNormalizer', () => {
    const normalizeProvider = createProviderNormalizer({ tokens: TEST_TOKENS });

    describe('CLASS_TOKEN providers (decorated classes)', () => {
      it('should normalize decorated class to CLASS_TOKEN', () => {
        class DecoratedService {}
        Reflect.defineMetadata(TEST_TOKENS.type, true, DecoratedService);
        Reflect.defineMetadata(TEST_TOKENS.name, 'DecoratedService', DecoratedService);
        Reflect.defineMetadata(TEST_TOKENS.scope, ProviderScope.GLOBAL, DecoratedService);

        const record = normalizeProvider(DecoratedService);

        expect(record.kind).toBe(ProviderKind.CLASS_TOKEN);
        expect(record.provide).toBe(DecoratedService);
        expect(record.metadata.name).toBe('DecoratedService');
        expect(record.metadata.scope).toBe(ProviderScope.GLOBAL);
      });

      it('should use class name as fallback', () => {
        class NoNameMeta {}
        Reflect.defineMetadata(TEST_TOKENS.type, true, NoNameMeta);

        const record = normalizeProvider(NoNameMeta);

        expect(record.kind).toBe(ProviderKind.CLASS_TOKEN);
        expect(record.metadata.name).toBe('NoNameMeta');
      });

      it('should include optional description and id', () => {
        class FullMeta {}
        Reflect.defineMetadata(TEST_TOKENS.type, true, FullMeta);
        Reflect.defineMetadata(TEST_TOKENS.name, 'FullMeta', FullMeta);
        Reflect.defineMetadata(TEST_TOKENS.description, 'A full metadata provider', FullMeta);
        Reflect.defineMetadata(TEST_TOKENS.id, 'full-meta-id', FullMeta);

        const record = normalizeProvider(FullMeta);

        expect(record.metadata.description).toBe('A full metadata provider');
        expect(record.metadata.id).toBe('full-meta-id');
      });
    });

    describe('plain classes (without decoration)', () => {
      it('should normalize plain class to CLASS_TOKEN', () => {
        class PlainService {}

        const record = normalizeProvider(PlainService);

        expect(record.kind).toBe(ProviderKind.CLASS_TOKEN);
        expect(record.provide).toBe(PlainService);
        expect(record.metadata.name).toBe('PlainService');
      });

      it('should use static metadata if available', () => {
        class StaticMetaService {
          static metadata = { name: 'CustomName', scope: ProviderScope.CONTEXT };
        }

        const record = normalizeProvider(StaticMetaService);

        expect(record.kind).toBe(ProviderKind.CLASS_TOKEN);
        expect(record.metadata.name).toBe('CustomName');
        expect(record.metadata.scope).toBe(ProviderScope.CONTEXT);
      });
    });

    describe('VALUE providers', () => {
      it('should normalize useValue provider', () => {
        const token = Symbol('config');
        const value = { setting: true };

        const record = normalizeProvider({
          provide: token,
          useValue: value,
        });

        expect(record.kind).toBe(ProviderKind.VALUE);
        expect(record.provide).toBe(token);
        if (record.kind === ProviderKind.VALUE) {
          expect(record.useValue).toBe(value);
        }
      });

      it('should use custom metadata if provided', () => {
        const token = Symbol('config');
        const record = normalizeProvider({
          provide: token,
          useValue: 'value',
          metadata: { name: 'ConfigValue', description: 'Config desc' },
        });

        expect(record.metadata.name).toBe('ConfigValue');
        expect(record.metadata.description).toBe('Config desc');
      });

      it('should use default metadata if not provided', () => {
        const token = Symbol('config');
        const record = normalizeProvider({
          provide: token,
          useValue: 'value',
        });

        expect(record.metadata.name).toBe('ValueProvider');
      });
    });

    describe('FACTORY providers', () => {
      it('should normalize useFactory provider', () => {
        const token = Symbol('factory');
        const factory = () => ({ created: true });

        const record = normalizeProvider({
          provide: token,
          useFactory: factory,
        });

        expect(record.kind).toBe(ProviderKind.FACTORY);
        expect(record.provide).toBe(token);
        if (record.kind === ProviderKind.FACTORY) {
          expect(record.useFactory).toBe(factory);
        }
      });

      it('should include inject function', () => {
        class Dep {}
        const token = Symbol('factory');
        const inject = () => [Dep];

        const record = normalizeProvider({
          provide: token,
          inject,
          useFactory: (dep: Dep) => ({ dep }),
        });

        expect(record.kind).toBe(ProviderKind.FACTORY);
        if (record.kind === ProviderKind.FACTORY) {
          expect(record.inject()).toEqual([Dep]);
        }
      });

      it('should use empty inject if not provided', () => {
        const token = Symbol('factory');
        const record = normalizeProvider({
          provide: token,
          useFactory: () => ({}),
        });

        expect(record.kind).toBe(ProviderKind.FACTORY);
        if (record.kind === ProviderKind.FACTORY) {
          expect(record.inject()).toEqual([]);
        }
      });

      it('should use custom metadata if provided', () => {
        const token = Symbol('factory');
        const record = normalizeProvider({
          provide: token,
          useFactory: () => ({}),
          metadata: { name: 'MyFactory' },
        });

        expect(record.metadata.name).toBe('MyFactory');
      });
    });

    describe('CLASS providers', () => {
      it('should normalize useClass provider', () => {
        abstract class AbstractService {}
        class ConcreteService extends AbstractService {}

        const record = normalizeProvider({
          provide: AbstractService,
          useClass: ConcreteService,
        });

        expect(record.kind).toBe(ProviderKind.CLASS);
        expect(record.provide).toBe(AbstractService);
        if (record.kind === ProviderKind.CLASS) {
          expect(record.useClass).toBe(ConcreteService);
        }
      });

      it('should use class name as default metadata', () => {
        class Service {}
        class Impl {}

        const record = normalizeProvider({
          provide: Service,
          useClass: Impl,
        });

        expect(record.metadata.name).toBe('Impl');
      });

      it('should use custom metadata if provided', () => {
        class Service {}
        class Impl {}

        const record = normalizeProvider({
          provide: Service,
          useClass: Impl,
          metadata: { name: 'CustomImpl' },
        });

        expect(record.metadata.name).toBe('CustomImpl');
      });
    });

    describe('error handling', () => {
      it('should throw for unrecognized format', () => {
        expect(() => normalizeProvider({ provide: Symbol('x') } as any)).toThrow(
          /Cannot normalize provider: unrecognized format/,
        );
      });
    });
  });

  describe('providerDiscoveryDeps', () => {
    const mockDepsOfClass = jest.fn<Type[], [Type, 'discovery' | 'invocation']>();

    beforeEach(() => {
      mockDepsOfClass.mockReset();
    });

    it('should return empty for VALUE providers', () => {
      const deps = providerDiscoveryDeps(
        { kind: ProviderKind.VALUE, provide: Symbol('x'), useValue: 'v', metadata: { name: 'V' } },
        new Set(),
        mockDepsOfClass,
      );
      expect(deps).toEqual([]);
      expect(mockDepsOfClass).not.toHaveBeenCalled();
    });

    it('should return empty for INJECTED providers', () => {
      class Injected {}
      const deps = providerDiscoveryDeps(
        { kind: ProviderKind.INJECTED, provide: Injected, metadata: { name: 'I' } },
        new Set(),
        mockDepsOfClass,
      );
      expect(deps).toEqual([]);
    });

    it('should return inject() result for FACTORY providers', () => {
      class DepA {}
      class DepB {}
      const deps = providerDiscoveryDeps(
        {
          kind: ProviderKind.FACTORY,
          provide: Symbol('f'),
          inject: () => [DepA, DepB],
          useFactory: () => ({}),
          metadata: { name: 'F' },
        },
        new Set(),
        mockDepsOfClass,
      );
      expect(deps).toEqual([DepA, DepB]);
    });

    it('should call depsOfClass for CLASS providers', () => {
      class ServiceImpl {}
      class DepA {}
      mockDepsOfClass.mockReturnValue([DepA]);

      const deps = providerDiscoveryDeps(
        {
          kind: ProviderKind.CLASS,
          provide: Symbol('s'),
          useClass: ServiceImpl,
          metadata: { name: 'S' },
        },
        new Set(),
        mockDepsOfClass,
      );

      expect(mockDepsOfClass).toHaveBeenCalledWith(ServiceImpl, 'discovery');
      expect(deps).toEqual([DepA]);
    });

    it('should call depsOfClass for CLASS_TOKEN providers', () => {
      class Service {}
      class DepA {}
      mockDepsOfClass.mockReturnValue([DepA]);

      const deps = providerDiscoveryDeps(
        { kind: ProviderKind.CLASS_TOKEN, provide: Service, metadata: { name: 'S' } },
        new Set(),
        mockDepsOfClass,
      );

      expect(mockDepsOfClass).toHaveBeenCalledWith(Service, 'discovery');
      expect(deps).toEqual([DepA]);
    });
  });

  describe('providerInvocationTokens', () => {
    const mockDepsOfClass = jest.fn<Type[], [Type, 'discovery' | 'invocation']>();

    beforeEach(() => {
      mockDepsOfClass.mockReset();
    });

    it('should return empty for VALUE providers', () => {
      const tokens = providerInvocationTokens(
        { kind: ProviderKind.VALUE, provide: Symbol('x'), useValue: 'v', metadata: { name: 'V' } },
        mockDepsOfClass,
      );
      expect(tokens).toEqual([]);
    });

    it('should return empty for INJECTED providers', () => {
      class Injected {}
      const tokens = providerInvocationTokens(
        { kind: ProviderKind.INJECTED, provide: Injected, metadata: { name: 'I' } },
        mockDepsOfClass,
      );
      expect(tokens).toEqual([]);
    });

    it('should return inject() result for FACTORY providers', () => {
      class DepA {}
      const tokens = providerInvocationTokens(
        {
          kind: ProviderKind.FACTORY,
          provide: Symbol('f'),
          inject: () => [DepA],
          useFactory: () => ({}),
          metadata: { name: 'F' },
        },
        mockDepsOfClass,
      );
      expect(tokens).toEqual([DepA]);
    });

    it('should call depsOfClass with invocation phase for CLASS', () => {
      class ServiceImpl {}
      class DepA {}
      mockDepsOfClass.mockReturnValue([DepA]);

      const tokens = providerInvocationTokens(
        {
          kind: ProviderKind.CLASS,
          provide: Symbol('s'),
          useClass: ServiceImpl,
          metadata: { name: 'S' },
        },
        mockDepsOfClass,
      );

      expect(mockDepsOfClass).toHaveBeenCalledWith(ServiceImpl, 'invocation');
      expect(tokens).toEqual([DepA]);
    });

    it('should call depsOfClass with invocation phase for CLASS_TOKEN', () => {
      class Service {}
      class DepA {}
      mockDepsOfClass.mockReturnValue([DepA]);

      const tokens = providerInvocationTokens(
        { kind: ProviderKind.CLASS_TOKEN, provide: Service, metadata: { name: 'S' } },
        mockDepsOfClass,
      );

      expect(mockDepsOfClass).toHaveBeenCalledWith(Service, 'invocation');
      expect(tokens).toEqual([DepA]);
    });
  });
});
