/**
 * @file resource.instance.completer.spec.ts
 * @description Tests for ResourceInstance.getArgumentCompleter, verifying:
 * - Convention-based completers (${argName}Completer methods) work with DI
 * - Override-based completers (getArgumentCompleter override) work with DI
 * - Convention takes priority over override
 * - Resources with no completer return null
 */

import 'reflect-metadata';
import { ResourceInstance } from '../resource.instance';
import { ResourceTemplate } from '../../common/decorators/resource.decorator';
import { normalizeResourceTemplate } from '../resource.utils';
import { ResourceContext } from '../../common/interfaces/resource.interface';

// Simple class to use as a DI token (Token = Type<T> | Reference<T>)
class TestService {
  listItems(): string[] {
    return [];
  }
}

const createMockProviderRegistry = (overrides?: { get?: jest.Mock }) => {
  const mockScope = {
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      }),
    },
    hooks: {
      registerHooks: jest.fn().mockResolvedValue(undefined),
    },
    providers: {
      getHooksRegistry: jest.fn().mockReturnValue({
        registerHooks: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };

  return {
    getActiveScope: jest.fn().mockReturnValue(mockScope),
    getScope: jest.fn().mockReturnValue(mockScope),
    get: overrides?.get ?? jest.fn(),
  } as any;
};

const createMockOwner = () => ({
  kind: 'app' as const,
  id: 'test-app',
  ref: {} as any,
});

describe('ResourceInstance - getArgumentCompleter', () => {
  describe('convention-based completer', () => {
    it('should discover and call ${argName}Completer method with DI access', async () => {
      const mockService = { listItems: () => ['alpha', 'beta', 'gamma'] };

      @ResourceTemplate({
        name: 'convention-completer',
        uriTemplate: 'items://{itemName}/details',
      })
      class ConventionResource extends ResourceContext<{ itemName: string }> {
        async execute(uri: string, params: { itemName: string }) {
          return { text: 'content' };
        }

        async itemNameCompleter(partial: string) {
          const service = this.get(TestService);
          const items = service.listItems();
          const values = items.filter((i: string) => i.startsWith(partial));
          return { values, total: values.length };
        }
      }

      const getMock = jest.fn().mockReturnValue(mockService);
      const providers = createMockProviderRegistry({ get: getMock });
      const record = normalizeResourceTemplate(ConventionResource);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('itemName');
      expect(completer).not.toBeNull();

      const result = await completer!('al');
      expect(result.values).toEqual(['alpha']);
    });

    it('should return null when no convention method exists for the argument', async () => {
      @ResourceTemplate({
        name: 'no-convention',
        uriTemplate: 'items://{itemName}/details',
      })
      class NoConventionResource extends ResourceContext<{ itemName: string }> {
        async execute(uri: string, params: { itemName: string }) {
          return { text: 'content' };
        }
      }

      const providers = createMockProviderRegistry();
      const record = normalizeResourceTemplate(NoConventionResource);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('itemName');
      expect(completer).toBeNull();
    });
  });

  describe('override-based completer', () => {
    it('should call overridden getArgumentCompleter with DI access', async () => {
      const mockService = { listItems: () => ['one', 'two', 'three'] };

      @ResourceTemplate({
        name: 'override-completer',
        uriTemplate: 'things://{thingId}',
      })
      class OverrideResource extends ResourceContext<{ thingId: string }> {
        async execute(uri: string, params: { thingId: string }) {
          return { text: 'content' };
        }

        getArgumentCompleter(argName: string) {
          if (argName === 'thingId') {
            return async (partial: string) => {
              const service = this.get(TestService);
              const items = service.listItems();
              const values = items.filter((i: string) => i.startsWith(partial));
              return { values };
            };
          }
          return null;
        }
      }

      const getMock = jest.fn().mockReturnValue(mockService);
      const providers = createMockProviderRegistry({ get: getMock });
      const record = normalizeResourceTemplate(OverrideResource);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('thingId');
      expect(completer).not.toBeNull();

      const result = await completer!('t');
      expect(result.values).toEqual(['two', 'three']);
    });

    it('should return null from override when no match for argName', async () => {
      @ResourceTemplate({
        name: 'override-no-match',
        uriTemplate: 'things://{thingId}',
      })
      class OverrideNoMatch extends ResourceContext<{ thingId: string }> {
        async execute(uri: string, params: { thingId: string }) {
          return { text: 'content' };
        }

        getArgumentCompleter(argName: string) {
          if (argName === 'userId') {
            return async (partial: string) => ({ values: [] as string[] });
          }
          return null;
        }
      }

      const providers = createMockProviderRegistry();
      const record = normalizeResourceTemplate(OverrideNoMatch);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('thingId');
      expect(completer).toBeNull();
    });
  });

  describe('convention takes priority over override', () => {
    it('should use convention method when both are present', async () => {
      @ResourceTemplate({
        name: 'priority-test',
        uriTemplate: 'items://{itemId}',
      })
      class PriorityResource extends ResourceContext<{ itemId: string }> {
        async execute(uri: string, params: { itemId: string }) {
          return { text: 'content' };
        }

        async itemIdCompleter(partial: string) {
          return { values: ['from-convention'] };
        }

        getArgumentCompleter(argName: string) {
          if (argName === 'itemId') {
            return async (partial: string) => ({ values: ['from-override'] });
          }
          return null;
        }
      }

      const providers = createMockProviderRegistry();
      const record = normalizeResourceTemplate(PriorityResource);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('itemId');
      expect(completer).not.toBeNull();

      const result = await completer!('');
      expect(result.values).toEqual(['from-convention']);
    });
  });

  describe('no completer', () => {
    it('should return null for resource with no completers', async () => {
      @ResourceTemplate({
        name: 'no-completer',
        uriTemplate: 'items://{itemId}',
      })
      class NoCompleter extends ResourceContext<{ itemId: string }> {
        async execute(uri: string, params: { itemId: string }) {
          return { text: 'content' };
        }
      }

      const providers = createMockProviderRegistry();
      const record = normalizeResourceTemplate(NoCompleter);
      const instance = new ResourceInstance(record, providers, createMockOwner());
      await instance.ready;

      const completer = instance.getArgumentCompleter('itemId');
      expect(completer).toBeNull();
    });
  });
});
