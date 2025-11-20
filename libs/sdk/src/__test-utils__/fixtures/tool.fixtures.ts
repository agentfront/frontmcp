/// <reference types="jest" />
/**
 * Test fixtures for tools
 */

import { z } from 'zod';
import { ToolMetadata } from '../../common/metadata';

/**
 * Simple test tool metadata
 */
export function createToolMetadata(overrides: Partial<ToolMetadata> = {}): ToolMetadata {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: {
      text: z.string(),
    },
    outputSchema: 'string',
    ...overrides,
  };
}

/**
 * Creates a simple echo tool metadata
 */
export function createEchoToolMetadata(): ToolMetadata {
  return {
    name: 'echo',
    description: 'Echoes back the input',
    inputSchema: {
      message: z.string().describe('Message to echo'),
    },
    outputSchema: 'string',
  };
}

/**
 * Creates a calculator tool metadata
 */
export function createCalculatorToolMetadata(): ToolMetadata {
  return {
    name: 'calculator',
    description: 'Performs basic arithmetic',
    inputSchema: {
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
      a: z.number(),
      b: z.number(),
    },
    outputSchema: 'number',
  };
}

/**
 * Creates a tool with structured output
 */
export function createStructuredOutputToolMetadata(): ToolMetadata {
  return {
    name: 'get_user',
    description: 'Gets user information',
    inputSchema: {
      userId: z.string(),
    },
    outputSchema: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().email(),
    }),
  };
}

/**
 * Mock tool class for testing
 */
export class MockToolClass {
  async execute(input: { text: string }): Promise<string> {
    return `Echo: ${input.text}`;
  }
}

/**
 * Mock tool instance for testing
 */
export function createMockToolInstance(metadata?: Partial<ToolMetadata>) {
  return {
    metadata: createToolMetadata(metadata),
    execute: jest.fn(async (input: any) => `Result: ${JSON.stringify(input)}`),
  };
}
