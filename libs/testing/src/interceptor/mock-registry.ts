/**
 * @file mock-registry.ts
 * @description Registry for managing request mocks
 */

import type { JsonRpcRequest, JsonRpcResponse } from '../transport/transport.interface';
import type { MockDefinition, MockRegistry, MockHandle } from './interceptor.types';

/**
 * Internal mock entry with tracking
 */
interface MockEntry {
  definition: MockDefinition;
  callCount: number;
  calls: JsonRpcRequest[];
  remainingUses: number;
}

/**
 * Default implementation of MockRegistry
 */
export class DefaultMockRegistry implements MockRegistry {
  private mocks: MockEntry[] = [];

  add(mock: MockDefinition): MockHandle {
    const entry: MockEntry = {
      definition: mock,
      callCount: 0,
      calls: [],
      remainingUses: mock.times ?? Infinity,
    };

    this.mocks.push(entry);

    return {
      remove: () => {
        const index = this.mocks.indexOf(entry);
        if (index !== -1) {
          this.mocks.splice(index, 1);
        }
      },
      callCount: () => entry.callCount,
      calls: () => [...entry.calls],
    };
  }

  clear(): void {
    this.mocks = [];
  }

  getAll(): MockDefinition[] {
    return this.mocks.map((e) => e.definition);
  }

  match(request: JsonRpcRequest): MockDefinition | undefined {
    for (const entry of this.mocks) {
      if (entry.remainingUses <= 0) continue;

      const { definition } = entry;

      // Check method match
      if (definition.method !== request.method) continue;

      // Check params match if specified
      if (definition.params !== undefined) {
        const params = request.params ?? {};

        if (typeof definition.params === 'function') {
          // Custom matcher function
          if (!definition.params(params)) continue;
        } else {
          // Object deep equality check
          if (!this.paramsMatch(definition.params, params)) continue;
        }
      }

      // Found a match - update tracking
      entry.callCount++;
      entry.calls.push(request);
      entry.remainingUses--;

      return definition;
    }

    return undefined;
  }

  /**
   * Check if request params match the mock params definition
   */
  private paramsMatch(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in actual)) return false;

      const actualValue = actual[key];

      // Handle arrays explicitly
      if (Array.isArray(value)) {
        if (!Array.isArray(actualValue)) return false;
        if (value.length !== actualValue.length) return false;
        for (let i = 0; i < value.length; i++) {
          const expectedItem = value[i];
          const actualItem = actualValue[i];
          if (typeof expectedItem === 'object' && expectedItem !== null) {
            if (typeof actualItem !== 'object' || actualItem === null) return false;
            if (!this.paramsMatch(expectedItem as Record<string, unknown>, actualItem as Record<string, unknown>)) {
              return false;
            }
          } else if (actualItem !== expectedItem) {
            return false;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        if (typeof actualValue !== 'object' || actualValue === null) return false;
        if (!this.paramsMatch(value as Record<string, unknown>, actualValue as Record<string, unknown>)) {
          return false;
        }
      } else if (actualValue !== value) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Helper to create mock responses
 */
export const mockResponse = {
  /**
   * Create a successful JSON-RPC response
   */
  success<T>(result: T, id: string | number = 1): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  },

  /**
   * Create an error JSON-RPC response
   */
  error(code: number, message: string, data?: unknown, id: string | number | null = 1): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
  },

  /**
   * Create a tool result response
   */
  toolResult(
    content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>,
    id: string | number = 1,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: { content },
    };
  },

  /**
   * Create a tools/list response
   */
  toolsList(
    tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>,
    id: string | number = 1,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  },

  /**
   * Create a resources/list response
   */
  resourcesList(
    resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>,
    id: string | number = 1,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources },
    };
  },

  /**
   * Create a resources/read response
   */
  resourceRead(
    contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>,
    id: string | number = 1,
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      result: { contents },
    };
  },

  /**
   * Common MCP errors
   */
  errors: {
    methodNotFound: (method: string, id: string | number | null = 1) =>
      mockResponse.error(-32601, `Method not found: ${method}`, undefined, id),

    invalidParams: (message: string, id: string | number | null = 1) =>
      mockResponse.error(-32602, message, undefined, id),

    internalError: (message: string, id: string | number | null = 1) =>
      mockResponse.error(-32603, message, undefined, id),

    resourceNotFound: (uri: string, id: string | number | null = 1) =>
      mockResponse.error(-32002, `Resource not found: ${uri}`, { uri }, id),

    toolNotFound: (name: string, id: string | number | null = 1) =>
      mockResponse.error(-32601, `Tool not found: ${name}`, { name }, id),

    unauthorized: (id: string | number | null = 1) => mockResponse.error(-32001, 'Unauthorized', undefined, id),

    forbidden: (id: string | number | null = 1) => mockResponse.error(-32003, 'Forbidden', undefined, id),
  },
};
