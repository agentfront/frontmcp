/// <reference types="jest" />
/**
 * Mock factory for FlowInstance
 */

/**
 * Creates a mock FlowInstance for testing
 */
export function createMockFlowInstance(overrides: Partial<any> = {}) {
  const stages = new Map<string, any>();

  return {
    stages,
    name: 'TestFlow',
    metadata: {
      name: 'TestFlow',
      stages: ['pre', 'execute', 'post', 'finalize'],
    },

    execute: jest.fn(async (context: any) => {
      return { success: true, result: 'mock result' };
    }),

    addStage: jest.fn((stageName: string, handler: any) => {
      stages.set(stageName, handler);
    }),

    getStage: jest.fn((stageName: string) => {
      return stages.get(stageName);
    }),

    hasStage: jest.fn((stageName: string) => {
      return stages.has(stageName);
    }),

    run: jest.fn(async (context: any) => {
      // Mock run implementation
      return context;
    }),

    ...overrides,
  };
}

/**
 * Creates a mock flow context
 */
export function createMockFlowContext(overrides: Partial<any> = {}) {
  return {
    flowName: 'TestFlow',
    stage: 'execute',
    data: {},
    result: undefined,
    error: undefined,

    respond: jest.fn((result: any) => {
      return { responded: true, result };
    }),

    fail: jest.fn((error: any) => {
      return { failed: true, error };
    }),

    abort: jest.fn(() => {
      return { aborted: true };
    }),

    next: jest.fn(async () => {
      return { continued: true };
    }),

    ...overrides,
  };
}

/**
 * Creates a mock stage handler
 */
export function createMockStageHandler(implementation?: (ctx: any) => Promise<any>) {
  return jest.fn(implementation || (async (ctx: any) => ctx));
}
