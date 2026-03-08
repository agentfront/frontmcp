// file: libs/plugins/src/codecall/__tests__/invoke.tool.test.ts

import InvokeTool from '../tools/invoke.tool';
import { isBlockedSelfReference } from '../security/self-reference-guard';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Helper to create a mock MCP CallToolResult
function createMockMcpResult(data: unknown, isError = false): CallToolResult {
  if (isError) {
    return {
      content: [{ type: 'text', text: data as string }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError: false,
  };
}

// Helper to assert error result in CallToolResult format
function assertErrorResult(result: CallToolResult): void {
  expect(result.isError).toBe(true);
  expect(result.content).toBeDefined();
  expect(result.content.length).toBeGreaterThan(0);
}

// Helper to extract text from CallToolResult
function getResultText(result: CallToolResult): string {
  const textContent = result.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent ? textContent.text : '';
}

// Mock the SDK - the mock class accepts any args to match ToolContext constructor
jest.mock('@frontmcp/sdk', () => ({
  Tool: (config: any) => (target: any) => target,

  Provider: (config: any) => (target: any) => target,
  ProviderScope: { GLOBAL: 'global', REQUEST: 'request' },
  ToolContext: class MockToolContext {
    scope = {
      tools: {
        getTools: jest.fn(() => []),
      },
      runFlow: jest.fn(() => Promise.resolve(null)),
    };
    authInfo = undefined;
    logger = undefined;

    constructor(_args?: any) {
      // Mock constructor accepts optional args
    }
  },
}));

describe('InvokeTool', () => {
  describe('Constructor Validation', () => {
    it('should instantiate InvokeTool correctly', () => {
      const tool = new (InvokeTool as any)();
      expect(tool).toBeDefined();
    });
  });

  describe('Security: Self-Reference Blocking', () => {
    it('should block invocation of codecall:execute', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:execute',
        input: { script: 'return 1' },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:search', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:search',
        input: { query: 'users' },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:describe', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:describe',
        input: { toolNames: ['users:list'] },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:invoke (self)', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:invoke',
        input: { tool: 'users:list', input: {} },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block any codecall: prefixed tool', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'codecall:custom-tool',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block CODECALL: prefix case-insensitively', async () => {
      const tool = new (InvokeTool as any)();

      const result = await tool.execute({
        tool: 'CODECALL:Execute',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });
  });

  describe('Tool Not Found', () => {
    it('should return error when flow returns null (tool not found)', async () => {
      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(null)),
      };

      const result = await tool.execute({
        tool: 'nonexistent:tool',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('not found');
      expect(getResultText(result)).toContain('nonexistent:tool');
    });

    it('should suggest using codecall:search when tool not found', async () => {
      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(null)),
      };

      const result = await tool.execute({
        tool: 'unknown:tool',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('codecall:search');
    });
  });

  describe('Successful Invocation via Flow', () => {
    it('should return CallToolResult directly from flow', async () => {
      const mockFlowResult = createMockMcpResult({ id: '123', name: 'Test User' });

      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(mockFlowResult)),
      };

      const result = await tool.execute({
        tool: 'users:create',
        input: { name: 'Test User' },
      });

      // Result should be passed through directly from flow
      expect(result).toEqual(mockFlowResult);
      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(1);
    });

    it('should pass through flow error results unchanged', async () => {
      const mockErrorResult = createMockMcpResult('Database connection failed', true);

      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(mockErrorResult)),
      };

      const result = await tool.execute({
        tool: 'users:delete',
        input: { id: '123' },
      });

      // Error results from flow should be passed through as-is
      expect(result).toEqual(mockErrorResult);
      expect(result.isError).toBe(true);
    });

    it('should call runFlow with correct request format', async () => {
      const mockFlowResult = createMockMcpResult({ success: true });
      const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: mockRunFlow,
      };
      tool.authInfo = { userId: 'test-user' };

      await tool.execute({
        tool: 'billing:getInvoice',
        input: { invoiceId: 'inv-123' },
      });

      expect(mockRunFlow).toHaveBeenCalledWith('tools:call-tool', {
        request: {
          method: 'tools/call',
          params: {
            name: 'billing:getInvoice',
            arguments: { invoiceId: 'inv-123' },
          },
        },
        ctx: {
          authInfo: { userId: 'test-user' },
        },
      });
    });
  });

  describe('Complex Result Types', () => {
    it('should handle results with multiple content items', async () => {
      const multiContentResult: CallToolResult = {
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' },
        ],
        isError: false,
      };

      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(multiContentResult)),
      };

      const result = await tool.execute({
        tool: 'report:generate',
        input: {},
      });

      expect(result.content).toHaveLength(2);
      expect(result.isError).toBe(false);
    });

    it('should handle results with image content', async () => {
      const imageResult: CallToolResult = {
        content: [{ type: 'image', data: 'base64data', mimeType: 'image/png' }],
        isError: false,
      };

      const tool = new (InvokeTool as any)();
      tool.scope = {
        runFlow: jest.fn(() => Promise.resolve(imageResult)),
      };

      const result = await tool.execute({
        tool: 'chart:render',
        input: {},
      });

      expect(result.content[0].type).toBe('image');
      expect(result.isError).toBe(false);
    });
  });
});

describe('Input Edge Cases', () => {
  it('should handle empty tool name (via flow)', async () => {
    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
    };

    const result = await tool.execute({
      tool: '',
      input: {},
    });

    // Empty tool name leads to "not found" since no tool has empty name
    assertErrorResult(result);
    expect(getResultText(result)).toContain('not found');
  });

  it('should handle tool name with only whitespace', async () => {
    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
    };

    const result = await tool.execute({
      tool: '   ',
      input: {},
    });

    assertErrorResult(result);
    expect(getResultText(result)).toContain('not found');
  });

  it('should handle very long tool name', async () => {
    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
    };

    const veryLongToolName = 'a'.repeat(10000);
    const result = await tool.execute({
      tool: veryLongToolName,
      input: {},
    });

    assertErrorResult(result);
  });

  it('should handle tool name with special characters', async () => {
    const mockFlowResult = createMockMcpResult({ success: true });

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(mockFlowResult)),
    };

    const result = await tool.execute({
      tool: 'app:tool-with-dashes_and_underscores',
      input: {},
    });

    expect(result.isError).toBe(false);
  });

  it('should pass empty input object to flow', async () => {
    const mockFlowResult = createMockMcpResult({ data: 'test' });
    const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: mockRunFlow,
    };

    await tool.execute({
      tool: 'users:list',
      input: {},
    });

    expect(mockRunFlow).toHaveBeenCalledWith('tools:call-tool', {
      request: {
        method: 'tools/call',
        params: {
          name: 'users:list',
          arguments: {},
        },
      },
      ctx: { authInfo: undefined },
    });
  });

  it('should handle deeply nested input objects', async () => {
    const mockFlowResult = createMockMcpResult({ success: true });
    const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: mockRunFlow,
    };

    const deeplyNestedInput = {
      level1: {
        level2: {
          level3: {
            level4: {
              value: 'deep',
            },
          },
        },
      },
    };

    await tool.execute({
      tool: 'complex:tool',
      input: deeplyNestedInput,
    });

    expect(mockRunFlow).toHaveBeenCalledWith('tools:call-tool', {
      request: {
        method: 'tools/call',
        params: {
          name: 'complex:tool',
          arguments: deeplyNestedInput,
        },
      },
      ctx: { authInfo: undefined },
    });
  });

  it('should handle input with array values', async () => {
    const mockFlowResult = createMockMcpResult({ success: true });
    const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: mockRunFlow,
    };

    const inputWithArrays = {
      ids: [1, 2, 3],
      tags: ['a', 'b', 'c'],
      nested: [{ id: 1 }, { id: 2 }],
    };

    await tool.execute({
      tool: 'batch:process',
      input: inputWithArrays,
    });

    expect(mockRunFlow).toHaveBeenCalledWith(
      'tools:call-tool',
      expect.objectContaining({
        request: expect.objectContaining({
          params: expect.objectContaining({
            arguments: inputWithArrays,
          }),
        }),
      }),
    );
  });

  it('should handle input with null values', async () => {
    const mockFlowResult = createMockMcpResult({ success: true });
    const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: mockRunFlow,
    };

    await tool.execute({
      tool: 'users:update',
      input: { name: 'test', email: null },
    });

    expect(mockRunFlow).toHaveBeenCalledWith(
      'tools:call-tool',
      expect.objectContaining({
        request: expect.objectContaining({
          params: expect.objectContaining({
            arguments: { name: 'test', email: null },
          }),
        }),
      }),
    );
  });

  it('should handle input with unicode values', async () => {
    const mockFlowResult = createMockMcpResult({ success: true });
    const mockRunFlow = jest.fn(() => Promise.resolve(mockFlowResult));

    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: mockRunFlow,
    };

    await tool.execute({
      tool: 'users:create',
      input: { name: '日本語ユーザー', emoji: '🚀' },
    });

    expect(mockRunFlow).toHaveBeenCalledWith(
      'tools:call-tool',
      expect.objectContaining({
        request: expect.objectContaining({
          params: expect.objectContaining({
            arguments: { name: '日本語ユーザー', emoji: '🚀' },
          }),
        }),
      }),
    );
  });

  it('should propagate flow exceptions as error result', async () => {
    const tool = new (InvokeTool as any)();
    tool.scope = {
      runFlow: jest.fn(() => Promise.reject(new Error('Flow execution failed'))),
    };

    await expect(
      tool.execute({
        tool: 'users:list',
        input: {},
      }),
    ).rejects.toThrow('Flow execution failed');
  });
});

describe('Integration: Self-Reference Guard', () => {
  it('should use the same guard as execute.tool.ts', () => {
    // Verify the guard works correctly
    expect(isBlockedSelfReference('codecall:execute')).toBe(true);
    expect(isBlockedSelfReference('codecall:invoke')).toBe(true);
    expect(isBlockedSelfReference('codecall:search')).toBe(true);
    expect(isBlockedSelfReference('codecall:describe')).toBe(true);

    // Non-codecall tools should be allowed
    expect(isBlockedSelfReference('users:list')).toBe(false);
    expect(isBlockedSelfReference('billing:invoice')).toBe(false);
  });
});
