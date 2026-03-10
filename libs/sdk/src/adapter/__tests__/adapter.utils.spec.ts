/**
 * Unit tests for adapter utilities
 */

import 'reflect-metadata';
import { normalizeAdapter, collectAdapterMetadata, adapterDiscoveryDeps } from '../adapter.utils';
import { Adapter } from '../../common/decorators/adapter.decorator';
import { AdapterInterface, FrontMcpAdapterResponse } from '../../common/interfaces';
import { AdapterKind } from '../../common/records';

/** Minimal adapter implementation for testing */
class StubAdapter implements AdapterInterface {
  options = { name: 'stub' };
  fetch(): FrontMcpAdapterResponse {
    return { tools: [] };
  }
}

describe('Adapter Utils', () => {
  describe('collectAdapterMetadata', () => {
    it('should collect metadata from decorated adapter class', () => {
      @Adapter({ name: 'TestAdapter', description: 'A test adapter' })
      class TestAdapter extends StubAdapter {}

      const metadata = collectAdapterMetadata(TestAdapter);

      expect(metadata.name).toBe('TestAdapter');
      expect(metadata.description).toBe('A test adapter');
    });

    it('should collect metadata with only name', () => {
      @Adapter({ name: 'NameOnly' })
      class NameOnlyAdapter extends StubAdapter {}

      const metadata = collectAdapterMetadata(NameOnlyAdapter);

      expect(metadata.name).toBe('NameOnly');
      expect(metadata.description).toBeUndefined();
    });

    it('should collect metadata with id', () => {
      @Adapter({ name: 'WithId', id: 'custom-id' })
      class WithIdAdapter extends StubAdapter {}

      const metadata = collectAdapterMetadata(WithIdAdapter);

      expect(metadata.name).toBe('WithId');
      expect(metadata.id).toBe('custom-id');
    });

    it('should return object with undefined values for undecorated class', () => {
      class PlainClass {}

      const metadata = collectAdapterMetadata(PlainClass);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBeUndefined();
      expect(metadata.description).toBeUndefined();
    });
  });

  describe('normalizeAdapter', () => {
    describe('Class Token Adapter', () => {
      it('should normalize a decorated class to CLASS_TOKEN kind', () => {
        @Adapter({ name: 'TestAdapter', description: 'A test' })
        class TestAdapter extends StubAdapter {}

        const record = normalizeAdapter(TestAdapter);

        expect(record.kind).toBe(AdapterKind.CLASS_TOKEN);
        expect(record.provide).toBe(TestAdapter);
        expect(record.metadata.name).toBe('TestAdapter');
        expect(record.metadata.description).toBe('A test');
      });
    });

    describe('Class Adapter with useClass', () => {
      it('should normalize an object with useClass to CLASS kind', () => {
        const TOKEN = Symbol('ADAPTER');
        class TestImpl extends StubAdapter {}

        const record = normalizeAdapter({
          provide: TOKEN,
          useClass: TestImpl,
          name: 'TestAdapter',
        });

        expect(record.kind).toBe(AdapterKind.CLASS);
        expect(record.provide).toBe(TOKEN);
        if (record.kind === AdapterKind.CLASS) {
          expect(record.useClass).toBe(TestImpl);
        }
      });

      it('should throw if useClass is not a class', () => {
        const TOKEN = Symbol('ADAPTER');

        expect(() =>
          normalizeAdapter({
            provide: TOKEN,
            useClass: 'not a class' as unknown as new (...args: unknown[]) => unknown,
            name: 'BadAdapter',
          }),
        ).toThrow(/must be a class/);
      });
    });

    describe('Factory Adapter', () => {
      it('should normalize an object with useFactory to FACTORY kind', () => {
        const TOKEN = Symbol('ADAPTER');
        const factory = () => new StubAdapter();

        const record = normalizeAdapter({
          provide: TOKEN,
          useFactory: factory,
          inject: () => [] as const,
          name: 'FactoryAdapter',
        });

        expect(record.kind).toBe(AdapterKind.FACTORY);
        expect(record.provide).toBe(TOKEN);
        if (record.kind === AdapterKind.FACTORY) {
          expect(record.useFactory).toBe(factory);
        }
      });

      it('should normalize with inject returning tokens', () => {
        const TOKEN = Symbol('ADAPTER');
        const DEP = Symbol('DEP');
        const factory = (_dep: unknown) => new StubAdapter();
        const inject = () => [DEP];

        const record = normalizeAdapter({
          provide: TOKEN,
          useFactory: factory,
          inject,
          name: 'InjectAdapter',
        });

        expect(record.kind).toBe(AdapterKind.FACTORY);
        if (record.kind === AdapterKind.FACTORY) {
          expect(record.inject).toBe(inject);
        }
      });

      it('should default inject to empty if not a function', () => {
        const TOKEN = Symbol('ADAPTER');
        const factory = () => new StubAdapter();

        const record = normalizeAdapter({
          provide: TOKEN,
          useFactory: factory,
        } as unknown as Parameters<typeof normalizeAdapter>[0]);

        expect(record.kind).toBe(AdapterKind.FACTORY);
        if (record.kind === AdapterKind.FACTORY) {
          expect(record.inject()).toEqual([]);
        }
      });

      it('should throw if useFactory is not a function', () => {
        const TOKEN = Symbol('ADAPTER');

        expect(() =>
          normalizeAdapter({
            provide: TOKEN,
            useFactory: 'not a function' as unknown as (...args: unknown[]) => unknown,
            inject: () => [] as const,
            name: 'BadFactory',
          }),
        ).toThrow(/must be a function/);
      });
    });

    describe('Value Adapter', () => {
      it('should normalize an object with useValue to VALUE kind', () => {
        const TOKEN = Symbol('ADAPTER');
        const value = new StubAdapter();

        const record = normalizeAdapter({
          provide: TOKEN,
          useValue: value,
          name: 'ValueAdapter',
        });

        expect(record.kind).toBe(AdapterKind.VALUE);
        expect(record.provide).toBe(TOKEN);
        if (record.kind === AdapterKind.VALUE) {
          expect(record.useValue).toBe(value);
        }
      });
    });

    describe('Error Handling', () => {
      it('should throw for missing provide', () => {
        expect(() =>
          normalizeAdapter({
            useValue: new StubAdapter(),
          } as unknown as Parameters<typeof normalizeAdapter>[0]),
        ).toThrow(/missing 'provide'/);
      });

      it('should throw for null input', () => {
        expect(() => normalizeAdapter(null as unknown as Parameters<typeof normalizeAdapter>[0])).toThrow(
          /Invalid adapter/,
        );
      });

      it('should throw for number input', () => {
        expect(() => normalizeAdapter(123 as unknown as Parameters<typeof normalizeAdapter>[0])).toThrow(
          /Invalid adapter/,
        );
      });

      it('should throw for string input', () => {
        expect(() => normalizeAdapter('string' as unknown as Parameters<typeof normalizeAdapter>[0])).toThrow(
          /Invalid adapter/,
        );
      });

      it('should throw for object with provide but no use* property', () => {
        const TOKEN = Symbol('ADAPTER');

        expect(() =>
          normalizeAdapter({
            provide: TOKEN,
          } as unknown as Parameters<typeof normalizeAdapter>[0]),
        ).toThrow(/Invalid adapter/);
      });
    });
  });

  describe('adapterDiscoveryDeps', () => {
    it('should return empty array for VALUE kind', () => {
      const TOKEN = Symbol('ADAPTER');
      const record = normalizeAdapter({
        provide: TOKEN,
        useValue: new StubAdapter(),
        name: 'ValueAdapter',
      });

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });

    it('should return injected tokens for FACTORY kind', () => {
      const TOKEN = Symbol('ADAPTER');
      const DEP1 = Symbol('DEP1');
      const DEP2 = Symbol('DEP2');

      const record = normalizeAdapter({
        provide: TOKEN,
        useFactory: (_d1: unknown, _d2: unknown) => new StubAdapter(),
        inject: () => [DEP1, DEP2],
        name: 'FactoryAdapter',
      });

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toEqual([DEP1, DEP2]);
    });

    it('should return empty array for FACTORY without dependencies', () => {
      const TOKEN = Symbol('ADAPTER');

      const record = normalizeAdapter({
        provide: TOKEN,
        useFactory: () => new StubAdapter(),
        inject: () => [] as const,
        name: 'EmptyFactory',
      });

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });

    it('should return empty array for CLASS kind without constructor deps', () => {
      class SimpleAdapter extends StubAdapter {
        constructor() {
          super();
        }
      }

      const TOKEN = Symbol('ADAPTER');
      const record = normalizeAdapter({
        provide: TOKEN,
        useClass: SimpleAdapter,
        name: 'SimpleAdapter',
      });

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });

    it('should return empty array for CLASS_TOKEN kind without constructor deps', () => {
      @Adapter({ name: 'TestAdapter' })
      class TestAdapter extends StubAdapter {
        constructor() {
          super();
        }
      }

      const record = normalizeAdapter(TestAdapter);

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toEqual([]);
    });

    it('should return constructor dependencies from CLASS kind', () => {
      class DepService {}
      class DepAdapter extends StubAdapter {
        constructor(public dep1: DepService) {
          super();
        }
      }

      Reflect.defineMetadata('design:paramtypes', [DepService], DepAdapter);

      const TOKEN = Symbol('ADAPTER');
      const record = normalizeAdapter({
        provide: TOKEN,
        useClass: DepAdapter,
        name: 'DepAdapter',
      });

      const deps = adapterDiscoveryDeps(record);
      expect(deps).toContain(DepService);
    });
  });
});
