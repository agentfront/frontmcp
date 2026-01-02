/// <reference types="jest" />
/**
 * Test fixtures for Scope and related setup
 */

import 'reflect-metadata';
import { Scope } from '../../scope';
import ProviderRegistry from '../../provider/provider.registry';
import { ProviderScope } from '@frontmcp/sdk';

/**
 * Creates a mock Scope for testing
 */
export function createMockScope() {
  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const mockHookRegistry = {
    registerHooks: jest.fn().mockResolvedValue(undefined),
    getHooks: jest.fn().mockReturnValue([]),
  };

  const mockProviders = {
    getHooksRegistry: jest.fn().mockReturnValue(mockHookRegistry),
    get: jest.fn().mockImplementation((token: any) => {
      if (token === Scope || token?.name === 'Scope') {
        // Return self-reference for Scope
        return mockScope;
      }
      return undefined;
    }),
    tryGet: jest.fn().mockReturnValue(undefined),
    getActiveScope: jest.fn().mockReturnValue(undefined),
  };

  const mockScope: any = {
    id: 'test-scope',
    logger: mockLogger,
    hooks: mockHookRegistry,
    providers: mockProviders,
    registryFlows: jest.fn().mockResolvedValue(undefined),
    metadata: {
      id: 'test-scope',
      http: { port: 3001 },
    },
  };

  // Make getActiveScope return the mockScope itself
  mockProviders.getActiveScope = jest.fn().mockReturnValue(mockScope);

  return mockScope as unknown as Scope;
}

/**
 * Creates a ProviderRegistry with a mock Scope for plugin testing
 */
export async function createProviderRegistryWithScope(providers: any[] = []) {
  const mockScope = createMockScope();

  const providerRegistry = new ProviderRegistry([
    {
      provide: Scope,
      useValue: mockScope,
      name: 'MockScope',
      scope: ProviderScope.GLOBAL,
    },
    ...providers,
  ]);

  await providerRegistry.ready;

  return providerRegistry;
}
