// file: libs/plugins/src/codecall/__tests__/invoke.tool.spec.ts

import type { CallToolResult } from '@frontmcp/protocol';

import CodeCallConfig from '../providers/code-call.config';
import { isBlockedSelfReference } from '../security/self-reference-guard';
import InvokeTool from '../tools/invoke.tool';

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
  Tool:
    (_config: unknown) =>
    <T>(target: T) =>
      target,

  Provider:
    (_config: unknown) =>
    <T>(target: T) =>
      target,
  ProviderScope: { GLOBAL: 'global', REQUEST: 'request' },
  BaseConfig: class MockBaseConfig {
    protected options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
    }
    get(key: string): unknown {
      return this.options[key];
    }
  },
  ToolContext: class MockToolContext {
    private dependencies = new Map<unknown, unknown>();
    scope = {
      tools: {
        getTools: jest.fn(() => []),
      },
      runFlow: jest.fn(() => Promise.resolve(null)),
    };
    authInfo = undefined;
    logger = undefined;

    constructor(_args?: unknown) {
      // Mock constructor accepts optional args
    }
    get<T>(token: unknown): T {
      return this.dependencies.get(token) as T;
    }
    tryGet<T>(token: unknown): T | undefined {
      return this.dependencies.get(token) as T | undefined;
    }
    _setDependency(token: unknown, instance: unknown): void {
      this.dependencies.set(token, instance);
    }
  },
}));

/** The mocked `ToolContext` surface these harnesses drive, in place of a real scope. */
interface MockedToolInstance {
  scope: { runFlow: jest.Mock; tools: { getTools: jest.Mock } };
  execute(input: Record<string, unknown>): Promise<unknown>;
  _setDependency(token: unknown, instance: unknown): void;
}

type MockedToolCtor = new () => MockedToolInstance;

/**
 * Since GHSA-6w3j-82v5-6qrr, `codecall:invoke` consults the CodeCall access policy before
 * running anything, so a tool has to be registered and the plugin config reachable for a
 * call to get as far as the flow. These helpers give each fixture the surroundings a real
 * scope would have.
 */
function createInvokeTool(registeredTools: string[] = []): MockedToolInstance {
  const tool = new (InvokeTool as unknown as MockedToolCtor)();
  tool._setDependency(CodeCallConfig, { get: () => undefined, getAll: () => ({}) });
  tool.scope.tools.getTools = jest.fn(() => registeredTools.map((name) => ({ name, fullName: name, metadata: {} })));
  return tool;
}

function setScope(tool: MockedToolInstance, runFlow: jest.Mock, registeredTools: string[] = []): void {
  tool.scope = {
    runFlow,
    tools: {
      getTools: jest.fn(() => registeredTools.map((name) => ({ name, fullName: name, metadata: {} }))),
    },
  };
}

describe('InvokeTool', () => {
  describe('Constructor Validation', () => {
    it('should instantiate InvokeTool correctly', () => {
      const tool = createInvokeTool();
      expect(tool).toBeDefined();
    });
  });

  describe('Security: Self-Reference Blocking', () => {
    it('should block invocation of codecall:execute', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'codecall:execute',
        input: { script: 'return 1' },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:search', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'codecall:search',
        input: { query: 'users' },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:describe', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'codecall:describe',
        input: { toolNames: ['users:list'] },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block invocation of codecall:invoke (self)', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'codecall:invoke',
        input: { tool: 'users:list', input: {} },
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block any codecall: prefixed tool', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'codecall:custom-tool',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });

    it('should block CODECALL: prefix case-insensitively', async () => {
      const tool = createInvokeTool();

      const result = await tool.execute({
        tool: 'CODECALL:Execute',
        input: {},
      });

      assertErrorResult(result);
      expect(getResultText(result)).toContain('cannot be invoked directly');
    });
  });

  describe('Tool Not Found', () => {
    it('should return an error when the named tool resolves to nothing', async () => {
      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(null)),
      );

      const result = await tool.execute({
        tool: 'nonexistent:tool',
        input: {},
      });

      assertErrorResult(result);
      // Deliberately the same wording a withheld tool gets: telling the two apart would
      // turn codecall:invoke into an existence oracle for tools the policy hides.
      expect(getResultText(result)).toContain('not available');
      expect(getResultText(result)).toContain('nonexistent:tool');
    });

    it('should suggest using codecall:search when a tool is unavailable', async () => {
      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(null)),
      );

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

      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(mockFlowResult)),
        ['users:create'],
      );

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

      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(mockErrorResult)),
        ['users:delete'],
      );

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

      const tool = createInvokeTool();
      setScope(tool, mockRunFlow, ['billing:getInvoice']);
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

      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(multiContentResult)),
        ['report:generate'],
      );

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

      const tool = createInvokeTool();
      setScope(
        tool,
        jest.fn(() => Promise.resolve(imageResult)),
        ['chart:render'],
      );

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
    const tool = createInvokeTool();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
      tools: { getTools: jest.fn(() => []) },
    };

    const result = await tool.execute({
      tool: '',
      input: {},
    });

    // An empty name matches no tool, so the access check refuses it before the flow.
    assertErrorResult(result);
    expect(getResultText(result)).toContain('not available');
  });

  it('should handle tool name with only whitespace', async () => {
    const tool = createInvokeTool();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
      tools: { getTools: jest.fn(() => []) },
    };

    const result = await tool.execute({
      tool: '   ',
      input: {},
    });

    assertErrorResult(result);
    expect(getResultText(result)).toContain('not available');
  });

  it('should handle very long tool name', async () => {
    const tool = createInvokeTool();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(null)),
      tools: { getTools: jest.fn(() => []) },
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

    const tool = createInvokeTool();
    tool.scope = {
      runFlow: jest.fn(() => Promise.resolve(mockFlowResult)),
      tools: {
        getTools: jest.fn(() => [
          {
            name: 'app:tool-with-dashes_and_underscores',
            fullName: 'app:tool-with-dashes_and_underscores',
            metadata: {},
          },
        ]),
      },
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

    const tool = createInvokeTool();
    tool.scope = {
      runFlow: mockRunFlow,
      tools: { getTools: jest.fn(() => [{ name: 'users:list', fullName: 'users:list', metadata: {} }]) },
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

    const tool = createInvokeTool();
    setScope(tool, mockRunFlow, ['complex:tool']);

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

    const tool = createInvokeTool();
    tool.scope = {
      runFlow: mockRunFlow,
      tools: { getTools: jest.fn(() => [{ name: 'batch:process', fullName: 'batch:process', metadata: {} }]) },
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

    const tool = createInvokeTool();
    tool.scope = {
      runFlow: mockRunFlow,
      tools: { getTools: jest.fn(() => [{ name: 'users:update', fullName: 'users:update', metadata: {} }]) },
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

    const tool = createInvokeTool();
    tool.scope = {
      runFlow: mockRunFlow,
      tools: { getTools: jest.fn(() => [{ name: 'users:create', fullName: 'users:create', metadata: {} }]) },
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
    const tool = createInvokeTool();
    tool.scope = {
      runFlow: jest.fn(() => Promise.reject(new Error('Flow execution failed'))),
      tools: { getTools: jest.fn(() => [{ name: 'users:list', fullName: 'users:list', metadata: {} }]) },
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
