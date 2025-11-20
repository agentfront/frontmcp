/// <reference types="jest" />
/**
 * Mock factory for ProviderRegistry
 */

import { Token } from '../../common/interfaces';
import { ProviderScope } from '../../common/metadata';

/**
 * Creates a mock ProviderRegistry for testing
 */
export function createMockProviderRegistry(overrides: Partial<any> = {}) {
  const instances = new Map<Token, any>();
  const defs = new Map<Token, any>();

  return {
    instances,
    defs,
    ready: Promise.resolve(),

    getProviders: jest.fn(() => []),

    get: jest.fn((token: Token) => {
      if (instances.has(token)) {
        return instances.get(token);
      }
      throw new Error(`Token not found: ${String(token)}`);
    }),

    has: jest.fn((token: Token) => instances.has(token)),

    set: jest.fn((token: Token, value: any) => {
      instances.set(token, value);
    }),

    resolve: jest.fn(async (token: Token) => {
      if (instances.has(token)) {
        return instances.get(token);
      }
      throw new Error(`Cannot resolve token: ${String(token)}`);
    }),

    createViews: jest.fn((sessionId?: string) => ({
      global: new Map(instances),
      session: new Map(),
      request: new Map(),
    })),

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
