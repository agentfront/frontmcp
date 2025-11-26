/// <reference types="jest" />
/**
 * Mock factory for ProviderRegistry
 */

import { Token } from '../../common/interfaces';
import { ProviderScope } from '../../common/metadata';

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
export function createMockOwner(id = 'test-app', kind: 'app' | 'adapter' | 'plugin' = 'app') {
  return {
    kind,
    id,
    ref: {} as Record<string, unknown>,
  };
}

/**
 * Creates a mock ProviderRegistry for testing
 */
export function createMockProviderRegistry(overrides: Partial<Record<string, unknown>> = {}) {
  const instances = new Map<Token, unknown>();
  const defs = new Map<Token, unknown>();
  const mockScope = createMockScope();

  return {
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

    getRegistries: jest.fn().mockReturnValue([]),

    addRegistry: jest.fn(),

    ...overrides,
  };
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
 * Adds a provider to a mock registry
 */
export function addProviderToMock(registry: ReturnType<typeof createMockProviderRegistry>, token: Token, value: any) {
  registry.instances.set(token, value);
  registry.has.mockImplementation((t: Token) => t === token || registry.instances.has(t));
  registry.get.mockImplementation((t: Token) => {
    if (t === token) return value;
    return registry.instances.get(t);
  });
}
