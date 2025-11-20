/// <reference types="jest" />
/**
 * Mock factory for ToolRegistry
 */

import { ToolMetadata } from '../../common/metadata';

/**
 * Creates a mock ToolRegistry for testing
 */
export function createMockToolRegistry(overrides: Partial<any> = {}) {
  const tools = new Map<string, any>();

  return {
    tools,

    register: jest.fn((name: string, toolInstance: any) => {
      tools.set(name, toolInstance);
      return toolInstance;
    }),

    get: jest.fn((name: string) => {
      return tools.get(name);
    }),

    has: jest.fn((name: string) => {
      return tools.has(name);
    }),

    getAll: jest.fn(() => {
      return Array.from(tools.values());
    }),

    getNames: jest.fn(() => {
      return Array.from(tools.keys());
    }),

    list: jest.fn(() => {
      return Array.from(tools.entries()).map(([name, tool]) => ({
        name,
        metadata: tool.metadata,
      }));
    }),

    clear: jest.fn(() => {
      tools.clear();
    }),

    call: jest.fn(async (name: string, input: any) => {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return tool.execute ? await tool.execute(input) : 'mock result';
    }),

    ...overrides,
  };
}

/**
 * Creates a mock tool entry
 */
export function createMockToolEntry(
  name: string,
  metadata?: Partial<ToolMetadata>,
  execute?: (input: any) => Promise<any>,
) {
  return {
    name,
    metadata: {
      name,
      description: `Mock tool: ${name}`,
      inputSchema: {},
      ...metadata,
    },
    execute: jest.fn(execute || (async (input: any) => `Result from ${name}`)),
  };
}

/**
 * Adds a tool to a mock registry
 */
export function addToolToMock(registry: ReturnType<typeof createMockToolRegistry>, name: string, toolEntry: any) {
  registry.tools.set(name, toolEntry);
  registry.has.mockImplementation((n: string) => n === name || registry.tools.has(n));
  registry.get.mockImplementation((n: string) => {
    if (n === name) return toolEntry;
    return registry.tools.get(n);
  });
}
