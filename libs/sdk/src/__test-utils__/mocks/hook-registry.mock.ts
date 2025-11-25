/// <reference types="jest" />
/**
 * Mock factory for HookRegistry
 */

import { HookMetadata } from '../../common/metadata';

/**
 * Creates a mock HookRegistry for testing
 */
export function createMockHookRegistry(overrides: Partial<any> = {}) {
  const hooks: HookMetadata[] = [];

  return {
    hooks,

    register: jest.fn((hookMetadata: HookMetadata) => {
      hooks.push(hookMetadata);
      return hookMetadata;
    }),

    getHooks: jest.fn(() => hooks),

    getHooksForFlow: jest.fn((flowName: string) => {
      return hooks.filter((h) => h.flow === flowName);
    }),

    getHooksForStage: jest.fn((flowName: string, stage: string) => {
      return hooks.filter((h) => h.flow === flowName && h.stage === stage);
    }),

    getHooksByPriority: jest.fn((flowName: string, stage: string) => {
      return hooks
        .filter((h) => h.flow === flowName && h.stage === stage)
        .sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }),

    clear: jest.fn(() => {
      hooks.length = 0;
    }),

    executeHooks: jest.fn(async (flowName: string, stage: string, context: any) => {
      const stageHooks = hooks.filter((h) => h.flow === flowName && h.stage === stage);
      for (const hook of stageHooks) {
        // Mock hook execution
      }
      return context;
    }),

    ...overrides,
  };
}

/**
 * Creates a mock hook entry
 */
export function createMockHookEntry(flowName: string, stage: string, priority: number = 0): HookMetadata {
  return {
    type: 'stage',
    flow: flowName as any,
    stage,
    target: Symbol('MOCK_HOOK'),
    method: 'onStage',
    priority,
  };
}

/**
 * Adds a hook to a mock registry
 */
export function addHookToMock(registry: ReturnType<typeof createMockHookRegistry>, hookMetadata: HookMetadata) {
  registry.hooks.push(hookMetadata);
}
