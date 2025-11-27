/// <reference types="jest" />
/**
 * Mock factory for ProviderRegistry
 */

import { Token } from '../../common/interfaces';
import { ProviderScope } from '../../common/metadata';
import type ProviderRegistry from '../../provider/provider.registry';
import type { EntryOwnerRef, EntryOwnerKind } from '../../common/entries';

/**
 * Creates a simple mock hook registry for provider testing
 * Note: For full HookRegistry mock, use createMockHookRegistry from hook-registry.mock.ts
 */
function createSimpleMockHookRegistry() {
  return {
    registerHooks: jest.fn().mockResolvedValue(undefined),
    getClsHooks: jest.fn().mockReturnValue([]),
    getFlowHooks: jest.fn().mockReturnValue([]),
    getFlowStageHooks: jest.fn().mockReturnValue([]),
    getFlowHooksForOwner: jest.fn().mockReturnValue([]),
  };
}

/**
 * Creates a mock scope for testing
 */
export function createMockScope() {
  const mockHookRegistry = createSimpleMockHookRegistry();

  return {
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      child: jest.fn().mockReturnThis(),
    },
    providers: {
      getHooksRegistry: jest.fn().mockReturnValue(mockHookRegistry),
    },
    hooks: mockHookRegistry,
    registryFlows: jest.fn().mockResolvedValue(undefined),
    prompts: {
      getPrompts: jest.fn().mockReturnValue([]),
      findByName: jest.fn().mockReturnValue(undefined),
    },
    resources: {
      getResources: jest.fn().mockReturnValue([]),
      findResourceForUri: jest.fn().mockReturnValue(undefined),
    },
    tools: {
      getTools: jest.fn().mockReturnValue([]),
    },
  };
}

/**
 * Creates a mock owner reference for testing
 */
export function createMockOwner(id = 'test-app', kind: EntryOwnerKind = 'app'): EntryOwnerRef {
  // Create a mock class to use as the ref token
  class MockOwnerRef {}

  return {
    kind,
    id,
    ref: MockOwnerRef as Token,
  };
}

/**
 * Creates a mock ProviderRegistry for testing
 *
 * Returns a partial mock that implements the most commonly used methods.
 * Cast to ProviderRegistry for type compatibility in tests.
 */
export function createMockProviderRegistry(overrides: Partial<Record<string, unknown>> = {}): ProviderRegistry {
  const instances = new Map<Token, unknown>();
  const defs = new Map<Token, unknown>();
  const mockScope = createMockScope();

  const mock = {
    instances,
    defs,
    ready: Promise.resolve(),

    getProviders: jest.fn(() => []),

    get: jest.fn((token: Token) => {
      if (instances.has(token)) {
        return instances.get(token);
      }
      // Return undefined instead of throwing for optional dependencies
      return undefined;
    }),

    has: jest.fn((token: Token) => instances.has(token)),

    set: jest.fn((token: Token, value: unknown) => {
      instances.set(token, value);
    }),

    resolve: jest.fn(async (token: Token) => {
      if (instances.has(token)) {
        return instances.get(token);
      }
      throw new Error(`Cannot resolve token: ${String(token)}`);
    }),

    createViews: jest.fn(() => ({
      global: new Map(instances),
      session: new Map(),
      request: new Map(),
    })),

    getActiveScope: jest.fn().mockReturnValue(mockScope),

    getScope: jest.fn().mockReturnValue(mockScope),

    getRegistries: jest.fn().mockReturnValue([]),

    addRegistry: jest.fn(),

    buildViews: jest.fn().mockResolvedValue({
      global: new Map(),
      session: new Map(),
      request: new Map(),
    }),

    ...overrides,
  };

  // Cast to ProviderRegistry - tests only use a subset of methods
  return mock as unknown as ProviderRegistry;
}

/**
 * Creates a mock provider entry
 */
export function createMockProviderEntry(token: Token, value: any, scope: ProviderScope = ProviderScope.GLOBAL) {
  return {
    token,
    value,
    scope,
    metadata: {
      name: String(token),
      scope,
    },
  };
}

/**
 * Internal type for accessing mock internals
 */
type MockProviderRegistryInternal = {
  instances: Map<Token, unknown>;
  has: jest.Mock;
  get: jest.Mock;
};

/**
 * Adds a provider to a mock registry
 */
export function addProviderToMock(registry: ProviderRegistry, token: Token, value: any) {
  // Access the mock internals through type assertion
  const mockRegistry = registry as unknown as MockProviderRegistryInternal;
  mockRegistry.instances.set(token, value);
  mockRegistry.has.mockImplementation((t: Token) => t === token || mockRegistry.instances.has(t));
  mockRegistry.get.mockImplementation((t: Token) => {
    if (t === token) return value;
    return mockRegistry.instances.get(t);
  });
}
