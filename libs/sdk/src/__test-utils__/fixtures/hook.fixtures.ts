/// <reference types="jest" />
/**
 * Test fixtures for hooks
 */

import { HookMetadata, HookStageType } from '../../common/metadata';
import { Token } from '../../common/interfaces';

/**
 * Test token for hook target
 */
export const TEST_HOOK_TARGET: Token = Symbol('TEST_HOOK_TARGET');

/**
 * Creates a simple hook metadata object
 */
export function createHookMetadata(
  overrides: Partial<HookMetadata> = {}
): HookMetadata {
  return {
    type: 'stage' as HookStageType,
    flow: 'CallToolFlow' as any,
    stage: 'execute',
    target: TEST_HOOK_TARGET,
    method: 'onExecute',
    priority: 0,
    ...overrides,
  };
}

/**
 * Creates a "will" stage hook metadata
 */
export function createWillHookMetadata(
  flow: string = 'CallToolFlow',
  stage: string = 'execute'
): HookMetadata {
  return {
    type: 'will',
    flow: flow as any,
    stage,
    target: TEST_HOOK_TARGET,
    method: 'willExecute',
    priority: 0,
  };
}

/**
 * Creates a "did" stage hook metadata
 */
export function createDidHookMetadata(
  flow: string = 'CallToolFlow',
  stage: string = 'execute'
): HookMetadata {
  return {
    type: 'did',
    flow: flow as any,
    stage,
    target: TEST_HOOK_TARGET,
    method: 'didExecute',
    priority: 0,
  };
}

/**
 * Creates an "around" stage hook metadata
 */
export function createAroundHookMetadata(
  flow: string = 'CallToolFlow',
  stage: string = 'execute'
): HookMetadata {
  return {
    type: 'around',
    flow: flow as any,
    stage,
    target: TEST_HOOK_TARGET,
    method: 'aroundExecute',
    priority: 0,
  };
}

/**
 * Mock hook class for testing
 */
export class MockHookClass {
  onExecute = jest.fn(async (ctx: any) => {
    // Mock hook implementation
  });

  willExecute = jest.fn(async (ctx: any) => {
    // Mock will hook implementation
  });

  didExecute = jest.fn(async (ctx: any) => {
    // Mock did hook implementation
  });

  aroundExecute = jest.fn(async (ctx: any, next: () => Promise<any>) => {
    // Mock around hook implementation
    return await next();
  });
}

/**
 * Creates a mock hook instance for testing
 */
export function createMockHookInstance(metadata?: Partial<HookMetadata>) {
  const mockClass = new MockHookClass();
  return {
    metadata: createHookMetadata(metadata),
    instance: mockClass,
    execute: mockClass.onExecute,
  };
}

/**
 * Creates multiple hooks with different priorities
 */
export function createPriorityHooks(priorities: number[]): HookMetadata[] {
  return priorities.map((priority, index) => ({
    type: 'stage' as HookStageType,
    flow: 'CallToolFlow' as any,
    stage: 'execute',
    target: Symbol(`HOOK_${index}`),
    method: 'onExecute',
    priority,
  }));
}
